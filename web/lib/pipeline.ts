import { db, uploadDocument, signedUrl } from "./supabase";
import { env } from "./env";
import { logEvent } from "./events";
import { ensureSender } from "./twilio";
import { extractFacts, resolveEntity } from "./identify";
import { upsertClaimFor, reportsForClaim, dollars } from "./assess";
import { buildDemandLetter, demandAmountCents } from "./letters";
import { buildSmallClaimsPacket } from "./smallclaims";
import { lobSendCertified, lobGetLetter, emailLetter } from "./lob";
import { tgSend, esc } from "./telegram";
import { getSetting } from "./settings";
import { runMonitor } from "./monitor";
import { BudgetExceeded, monthSpendCents, monthlyCapCents } from "./spend";
import { prettyPhone } from "./phone";
import type { Claim, Entity, Report } from "./types";

const AGENCIES = ["ftc", "fcc", "dnc"] as const;

/** Step 1: runs right after ingest (and again daily for anything stuck). */
export async function processReport(reportId: string, opts: { notify?: boolean } = {}): Promise<void> {
  const notify = opts.notify ?? true;
  const supa = db();
  const { data } = await supa.from("reports").select("*").eq("id", reportId).single();
  const report = data as Report;
  try {
    await supa.from("reports").update({ status: "identifying" }).eq("id", report.id);
    const sender = await ensureSender(report.sender_phone);
    const facts = report.extracted ?? (await extractFacts(report, sender));
    const entity = await resolveEntity(report, sender, facts);
    await supa.from("reports").update({
      sender_id: sender.id, extracted: facts, is_marketing: facts.is_marketing, category: facts.category,
      status: entity ? "identified" : "needs_identification", error: null,
    }).eq("id", report.id);

    // Government complaints: queue one job per agency (the browser worker files them).
    await supa.from("complaint_jobs").upsert(
      AGENCIES.filter((a) => a !== "dnc" || report.kind !== "voicemail").map((agency) => ({ report_id: report.id, agency })),
      { onConflict: "report_id,agency", ignoreDuplicates: true },
    );

    if (entity) {
      // A claim opened while the number was unidentified is superseded by the entity-level claim.
      await supa.from("claims").update({ status: "closed", notes: "Superseded: sender identified" })
        .is("entity_id", null).eq("sender_phone", report.sender_phone).in("status", ["assessing", "not_yet_viable"]);
    }
    const claim = await upsertClaimFor({ ...report, is_marketing: facts.is_marketing, extracted: facts }, entity);
    await logEvent(`Processed: entity=${entity?.name ?? "unknown"} marketing=${facts.is_marketing} claim=${claim.status}`, { reportId: report.id, claimId: claim.id });

    const who = entity ? `<b>${esc(entity.name)}</b>` : `unknown sender ${esc(prettyPhone(report.sender_phone))}`;
    const line2 = claim.status === "not_yet_viable"
      ? `Claim not yet viable: ${esc(claim.basis.reasons[0] ?? "")}`
      : `Claim ${esc(claim.status)} — ${claim.violation_count} violation(s), ${dollars(claim.estimated_min_cents)}–${dollars(claim.estimated_max_cents)}`;
    if (notify) await tgSend(`📨 <b>Reported ${report.kind}</b> from ${who}\n${esc((report.body ?? "").slice(0, 160))}\n\n${line2}\nFTC/FCC/DNC complaints queued.${entity ? "" : "\nReply <code>/entity " + report.id.slice(0, 8) + " | Company Name | mailing address</code> if you know who it is."}`, { silent: true });

    await advanceClaim(claim.id);
  } catch (e) {
    const msg = (e as Error).message;
    await supa.from("reports").update({ status: "error", error: msg }).eq("id", report.id);
    await logEvent("Processing failed: " + msg, { reportId: report.id, level: "error" });
    if (!(e instanceof BudgetExceeded)) await tgSend(`⚠️ Failed to process report ${report.id.slice(0, 8)}: ${esc(msg)}`);
  }
}

async function loadClaim(claimId: string): Promise<{ claim: Claim; entity: Entity | null; reports: Report[] }> {
  const supa = db();
  const { data: c } = await supa.from("claims").select("*").eq("id", claimId).single();
  const claim = c as Claim;
  let entity: Entity | null = null;
  if (claim.entity_id) {
    const { data: e } = await supa.from("entities").select("*").eq("id", claim.entity_id).maybeSingle();
    entity = (e as Entity) ?? null;
  }
  const reports = await reportsForClaim(claim.entity_id, claim.entity_id ? null : claim.sender_phone);
  return { claim, entity, reports };
}

function canMail(entity: Entity | null): boolean {
  return !!entity && !!entity.mailing_address && !!entity.mailing_address.line1 && !!entity.mailing_address.city && !!entity.mailing_address.state && !!entity.mailing_address.zip;
}

/** Step 2: move a claim forward through demand -> wait -> small claims. Idempotent; runs daily. */
export async function advanceClaim(claimId: string): Promise<void> {
  const supa = db();
  const { claim, entity, reports } = await loadClaim(claimId);
  const now = new Date();

  switch (claim.status) {
    case "assessing": {
      if (!(claim.basis.tcpa_c5 || claim.basis.tcpa_b3)) return;
      if (!entity) {
        await logEvent("Viable claim but sender unidentified; waiting for identification", { claimId, level: "warn" });
        return;
      }
      const mailable = canMail(entity);
      if (!mailable && !entity.email) {
        await logEvent("Viable claim but no mailing address or email for entity", { claimId, level: "warn" });
        await tgSend(`🏷 Claim against <b>${esc(entity.name)}</b> is viable (${claim.violation_count} violations) but I have no mailing address.\nLook it up (Arizona eCorp / home-state SoS / the company website) and reply:\n<code>/entity ${reports[0]?.id.slice(0, 8)} | ${esc(entity.name)} | 123 Main St, City, ST 00000</code>`);
        return;
      }
      const { pdf } = await buildDemandLetter(claim, entity, reports);
      const path = `claims/${claim.id}/demand-${now.toISOString().slice(0, 10)}.pdf`;
      await uploadDocument(path, pdf, "application/pdf");
      const holdHours = await getSetting<number>("demand_hold_hours", 24);
      const holdUntil = new Date(now.getTime() + holdHours * 3600_000);
      await supa.from("claims").update({
        status: "demand_hold", demand_letter_path: path, demand_hold_until: holdUntil.toISOString(), demand_amount_cents: demandAmountCents(claim),
      }).eq("id", claim.id);
      await logEvent(`Demand letter generated; auto-send at ${holdUntil.toISOString()}`, { claimId });
      const url = await signedUrl(path);
      await tgSend(
        `✉️ <b>Demand letter ready</b> for <b>${esc(entity.name)}</b>\nAmount: ${dollars(demandAmountCents(claim))} (${claim.violation_count} × $1,500)\nDelivery: ${mailable ? "USPS Certified via Lob (~" + dollars(env.lobCertifiedCents) + ")" : "email only"}\n\nIt will be sent automatically in ${holdHours}h unless you cancel.\n<a href="${url}">Preview PDF</a>`,
        { buttons: [[{ text: "Send now", callback_data: `send:${claim.id}` }, { text: "Cancel", callback_data: `cancel:${claim.id}` }]] },
      );
      return;
    }
    case "demand_hold": {
      if (claim.demand_hold_until && new Date(claim.demand_hold_until) > now) return;
      await sendDemand(claim.id);
      return;
    }
    case "demand_sent":
    case "awaiting_response": {
      // Refresh Lob tracking, then check deadline.
      if (claim.lob_letter_id) {
        const l = await lobGetLetter(claim.lob_letter_id);
        if (l) await supa.from("claims").update({ lob_tracking: { tracking_events: l.tracking_events, expected_delivery_date: l.expected_delivery_date } }).eq("id", claim.id);
      }
      if (claim.status === "demand_sent") await supa.from("claims").update({ status: "awaiting_response" }).eq("id", claim.id);
      if (claim.response_deadline && new Date(claim.response_deadline) < now && entity) {
        const pdf = await buildSmallClaimsPacket({ ...claim }, entity, reports);
        const path = `claims/${claim.id}/small-claims-packet.pdf`;
        await uploadDocument(path, pdf, "application/pdf");
        await supa.from("claims").update({ status: "small_claims_ready", small_claims_packet_path: path }).eq("id", claim.id);
        await logEvent("Deadline passed with no response; small claims packet generated", { claimId });
        const url = await signedUrl(path);
        await tgSend(`⚖️ <b>${esc(entity.name)}</b> did not respond by the deadline.\nSmall claims packet is ready: <a href="${url}">download PDF</a>\nFile it at your Justice Court precinct, then reply <code>/filed ${claim.id.slice(0, 8)}</code>. If they did respond, reply <code>/responded ${claim.id.slice(0, 8)}</code>.`);
      } else if (claim.response_deadline) {
        const daysLeft = Math.ceil((new Date(claim.response_deadline).getTime() - now.getTime()) / 86400_000);
        if ([14, 7, 1].includes(daysLeft)) await tgSend(`⏳ ${daysLeft} day(s) until the response deadline for <b>${esc(entity?.name ?? "")}</b>.`, { silent: true });
      }
      return;
    }
    default:
      return;
  }
}

/** Send the generated demand letter (called by the hold expiry or the Telegram "Send now" button). */
export async function sendDemand(claimId: string): Promise<void> {
  const supa = db();
  const { claim, entity, reports } = await loadClaim(claimId);
  if (!entity || claim.status !== "demand_hold") return;
  const { pdf, text } = await buildDemandLetter(claim, entity, reports);
  const channels: string[] = [];
  let lobId: string | null = null;
  try {
    if (canMail(entity)) {
      const letter = await lobSendCertified({ toName: entity.registered_agent?.name ?? entity.name, to: entity.mailing_address!, pdf, description: `TCPA demand ${claim.id}` });
      lobId = letter.id; channels.push("lob_certified");
    }
    if (entity.email && (await emailLetter(entity.email, "Demand for TCPA statutory damages", text, pdf))) channels.push("email");
  } catch (e) {
    const msg = (e as Error).message;
    await logEvent("Demand send failed: " + msg, { claimId, level: "error" });
    if (e instanceof BudgetExceeded) {
      await tgSend(`💸 Demand letter for <b>${esc(entity.name)}</b> is on hold: ${esc(msg)}. It will retry next month, or raise the cap in Settings.`);
      const nextMonth = new Date(); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 1); nextMonth.setUTCHours(15, 0, 0, 0);
      await supa.from("claims").update({ demand_hold_until: nextMonth.toISOString() }).eq("id", claim.id);
    } else {
      await tgSend(`⚠️ Could not send the demand letter for <b>${esc(entity.name)}</b>: ${esc(msg)}\nDownload it from the dashboard and mail it yourself, then reply <code>/sent ${claim.id.slice(0, 8)}</code>.`);
    }
    return;
  }
  if (channels.length === 0) {
    await tgSend(`⚠️ No delivery channel for <b>${esc(entity.name)}</b> (no valid address, no email). Download the letter from the dashboard and mail it yourself, then reply <code>/sent ${claim.id.slice(0, 8)}</code>.`);
    return;
  }
  await markDemandSent(claim.id, channels.join("+"), lobId);
  await tgSend(`📮 Demand letter sent to <b>${esc(entity.name)}</b> via ${channels.join(" + ")}. Response deadline in 30 days; I'll keep checking.`);
}

export async function markDemandSent(claimId: string, channel: string, lobId: string | null): Promise<void> {
  const deadline = new Date(); deadline.setDate(deadline.getDate() + 30);
  await db().from("claims").update({
    status: "demand_sent", demand_sent_at: new Date().toISOString(), demand_channel: channel, lob_letter_id: lobId,
    response_deadline: deadline.toISOString().slice(0, 10),
  }).eq("id", claimId);
  await logEvent(`Demand sent via ${channel}; deadline ${deadline.toISOString().slice(0, 10)}`, { claimId });
}

/** Daily cron entry point. */
export async function runDaily(): Promise<Record<string, number>> {
  const supa = db();
  const stats: Record<string, number> = { reprocessed: 0, claims: 0, monitor_hits: 0, complaints_stuck: 0 };

  // 1. Retry reports stuck in received/error/needs_identification (weekly for the latter).
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data: stuck } = await supa.from("reports").select("id,status,updated_at")
    .or(`status.eq.received,status.eq.error,and(status.eq.needs_identification,updated_at.lt.${weekAgo})`).limit(50);
  for (const r of stuck ?? []) { await processReport(r.id as string, { notify: r.status !== "needs_identification" }); stats.reprocessed++; }

  // 2. Advance every open claim.
  const { data: claims } = await supa.from("claims").select("id").not("status", "in", "(settled,closed,filed)");
  for (const c of claims ?? []) {
    try { await advanceClaim(c.id as string); stats.claims++; }
    catch (e) { await logEvent("advanceClaim failed: " + (e as Error).message, { claimId: c.id as string, level: "error" }); }
  }

  // 3. Complaint jobs that keep failing -> tell the user to file manually.
  const { data: failed } = await supa.from("complaint_jobs").select("id,agency,report_id,error").eq("status", "failed").gte("attempts", 3);
  for (const j of failed ?? []) {
    await supa.from("complaint_jobs").update({ status: "manual" }).eq("id", j.id);
    stats.complaints_stuck++;
    await tgSend(`🧾 The ${String(j.agency).toUpperCase()} complaint for report ${String(j.report_id).slice(0, 8)} failed 3 times (${esc(String(j.error ?? "")).slice(0, 120)}). Please file it by hand: ${agencyUrl(String(j.agency))}`);
  }

  // 4. Enforcement / settlement monitor.
  try { stats.monitor_hits = await runMonitor(); } catch (e) { await logEvent("monitor failed: " + (e as Error).message, { level: "error" }); }

  // 5. Weekly digest on Mondays.
  if (new Date().getUTCDay() === 1) await sendDigest();
  return stats;
}

export function agencyUrl(agency: string): string {
  return agency === "ftc" ? "https://reportfraud.ftc.gov/" : agency === "fcc" ? "https://consumercomplaints.fcc.gov/hc/en-us/requests/new?ticket_form_id=39744" : "https://www.donotcall.gov/report.html";
}

export async function sendDigest(): Promise<void> {
  const supa = db();
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [{ count: reports }, { count: submitted }, { data: claims }, spent, cap] = await Promise.all([
    supa.from("reports").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
    supa.from("complaint_jobs").select("id", { count: "exact", head: true }).eq("status", "submitted").gte("updated_at", weekAgo),
    supa.from("claims").select("status,estimated_min_cents,estimated_max_cents").not("status", "in", "(settled,closed)"),
    monthSpendCents(), monthlyCapCents(),
  ]);
  const byStatus: Record<string, number> = {};
  let min = 0, max = 0;
  for (const c of claims ?? []) { byStatus[c.status as string] = (byStatus[c.status as string] ?? 0) + 1; min += c.estimated_min_cents as number; max += c.estimated_max_cents as number; }
  await tgSend(
    `📊 <b>Weekly digest</b>\nReports this week: ${reports ?? 0}\nComplaints filed: ${submitted ?? 0}\nOpen claims: ${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}\nPotential recovery: ${dollars(min)}–${dollars(max)}\nSpend this month: ${dollars(spent)} of ${dollars(cap)}\n${env.publicBaseUrl}`,
    { silent: true },
  );
}
