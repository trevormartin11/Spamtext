import { db } from "./supabase";
import { dncRegisteredAt } from "./settings";
import { logEvent } from "./events";
import type { Claim, ClaimBasis, Entity, Report } from "./types";

export const STATUTORY_MIN_CENTS = 50_000;   // $500 per violation, 47 U.S.C. 227(c)(5) / (b)(3)
export const STATUTORY_MAX_CENTS = 150_000;  // $1,500 per willful/knowing violation
export const DNC_GRACE_DAYS = 31;            // registry effective after 31 days
export const AZ_SMALL_CLAIMS_LIMIT_CENTS = 350_000; // Arizona Justice Court small claims cap; verify with your precinct

/** Reports that count toward the same claim: same entity, or same phone when entity unknown, last 12 months. */
export async function reportsForClaim(entityId: string | null, senderPhone: string | null): Promise<Report[]> {
  const since = new Date(); since.setMonth(since.getMonth() - 12);
  const supa = db();
  if (entityId) {
    const { data: senders } = await supa.from("senders").select("phone").eq("entity_id", entityId);
    const phones = (senders ?? []).map((s) => s.phone as string);
    if (phones.length === 0) return [];
    const { data } = await supa.from("reports").select("*").in("sender_phone", phones).gte("received_at", since.toISOString()).order("received_at");
    return (data ?? []) as Report[];
  }
  if (senderPhone) {
    const { data } = await supa.from("reports").select("*").eq("sender_phone", senderPhone).gte("received_at", since.toISOString()).order("received_at");
    return (data ?? []) as Report[];
  }
  return [];
}

export function computeBasis(reports: Report[], dncDate: Date | null): ClaimBasis {
  const reasons: string[] = [];
  const marketing = reports.filter((r) => r.is_marketing !== false); // unknown counts until classified otherwise
  const first = reports[0] ? new Date(reports[0].received_at) : null;
  const dncEffective = dncDate ? new Date(dncDate.getTime() + DNC_GRACE_DAYS * 86400_000) : null;
  const dnc_eligible = !!(dncEffective && first && first >= dncEffective);
  if (!dncDate) reasons.push("Do Not Call registration date not set (use /dnc YYYY-MM-DD). DNC claims need the number registered 31+ days before the first message.");
  else if (!dnc_eligible) reasons.push("First message arrived before the Do Not Call registration became effective.");

  const tcpa_c5 = dnc_eligible && marketing.length >= 2;
  if (dnc_eligible && marketing.length < 2) reasons.push("Only one telemarketing message so far. 47 U.S.C. 227(c)(5) requires two or more in 12 months from the same seller; a second one makes the claim viable.");
  if (tcpa_c5) reasons.push(`${marketing.length} telemarketing messages in 12 months to a registered number (47 U.S.C. 227(c)(5); 47 C.F.R. 64.1200(c)(2)).`);

  const prerecorded = reports.filter((r) => r.kind !== "sms" && r.prerecorded === true);
  const tcpa_b3 = prerecorded.length > 0;
  if (tcpa_b3) reasons.push(`${prerecorded.length} call(s) tagged as recorded/artificial voice (47 U.S.C. 227(b)(1)(A)(iii), (b)(3)).`);

  const noId = marketing.filter((r) => r.kind === "sms" && r.extracted && !r.extracted.identifies_sender);
  const cfr_1200d = noId.length > 0 && marketing.length >= 1;
  if (cfr_1200d) reasons.push(`${noId.length} message(s) fail to identify the seller (47 C.F.R. 64.1200(d)(4)); supports a separate 64.1200(d) theory in the Ninth Circuit.`);

  const az_1282 = marketing.length >= 1;
  if (az_1282) reasons.push("Unsolicited solicitation to a mobile device is an unlawful practice under A.R.S. 44-1282 (Attorney General enforced; cited in the demand). If the seller is not registered with the Arizona Secretary of State, A.R.S. 44-1279 adds rescission, actual damages and attorney fees.");

  return { tcpa_c5, tcpa_b3, cfr_1200d, az_1282, dnc_eligible, reasons };
}

export function violationCount(reports: Report[], basis: ClaimBasis): number {
  const marketing = reports.filter((r) => r.is_marketing !== false);
  const prerecorded = reports.filter((r) => r.kind !== "sms" && r.prerecorded === true);
  if (basis.tcpa_c5) return marketing.length; // each message after registration counts
  if (basis.tcpa_b3) return prerecorded.length;
  return 0;
}

/** Create/refresh the claim for a report's entity (or phone) and return it. */
export async function upsertClaimFor(report: Report, entity: Entity | null): Promise<Claim> {
  const supa = db();
  const key = entity ? { entity_id: entity.id } : { sender_phone: report.sender_phone };
  let q = supa.from("claims").select("*").not("status", "in", "(settled,closed)");
  q = entity ? q.eq("entity_id", entity.id) : q.is("entity_id", null).eq("sender_phone", report.sender_phone);
  const { data: existing } = await q.maybeSingle();

  const reports = await reportsForClaim(entity?.id ?? null, entity ? null : report.sender_phone);
  const basis = computeBasis(reports, await dncRegisteredAt());
  const count = violationCount(reports, basis);
  const viable = basis.tcpa_c5 || basis.tcpa_b3;

  let claim: Claim;
  if (!existing) {
    const { data, error } = await supa.from("claims").insert({
      ...key, status: viable ? "assessing" : "not_yet_viable", violation_count: count, basis,
      estimated_min_cents: count * STATUTORY_MIN_CENTS, estimated_max_cents: count * STATUTORY_MAX_CENTS,
    }).select("*").single();
    if (error) throw new Error(error.message);
    claim = data as Claim;
    await logEvent(`Claim opened (${claim.status}), ${count} violation(s)`, { claimId: claim.id, reportId: report.id, data: basis });
  } else {
    claim = existing as Claim;
    const patch: Partial<Claim> = {
      violation_count: count, basis,
      estimated_min_cents: count * STATUTORY_MIN_CENTS, estimated_max_cents: count * STATUTORY_MAX_CENTS,
    };
    // Only move between the pre-demand states automatically; never regress a sent demand.
    if (["assessing", "not_yet_viable"].includes(claim.status)) patch.status = viable ? "assessing" : "not_yet_viable";
    const { data } = await supa.from("claims").update(patch).eq("id", claim.id).select("*").single();
    if (data) claim = data as Claim;
  }
  // Link every report in scope.
  if (reports.length) {
    await supa.from("claim_reports").upsert(reports.map((r) => ({ claim_id: claim.id, report_id: r.id })), { onConflict: "claim_id,report_id" });
  }
  return claim;
}

export function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
