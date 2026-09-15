import { env } from "./env";
import { SimpleDoc, fmtDate, fmtDateTime } from "./pdf";
import { AZ_SMALL_CLAIMS_LIMIT_CENTS, dollars, STATUTORY_MAX_CENTS, STATUTORY_MIN_CENTS } from "./assess";
import { prettyPhone } from "./phone";
import type { Claim, Entity, Report } from "./types";

/**
 * Arizona Justice Court small claims packet: a filled-in complaint narrative, exhibit list,
 * and step-by-step filing instructions. The court's own fillable form still has to be signed,
 * but everything to copy into it is here.
 */
export async function buildSmallClaimsPacket(claim: Claim, entity: Entity, reports: Report[]): Promise<Uint8Array> {
  const d = await SimpleDoc.create();
  const u = env.user;
  const full = claim.violation_count * STATUTORY_MAX_CENTS;
  const amount = Math.min(full, AZ_SMALL_CLAIMS_LIMIT_CENTS);
  const addr = entity.mailing_address;

  d.heading("Small Claims Filing Packet — Arizona Justice Court", 16);
  d.para(`Prepared ${fmtDate(new Date())} for ${u.fullName} v. ${entity.name}`);
  d.para("This packet was generated automatically. It is not legal advice. Read it, then file with the Justice Court precinct that covers your address or the defendant's address.", { bold: true });

  d.heading("1. Where and how to file", 12);
  d.bullet(`Court: Justice Court, ${u.county} County, Arizona — Small Claims Division. Find your precinct: https://justicecourts.maricopa.gov/ (Maricopa) or https://www.azcourts.gov/find-a-court for other counties.`);
  d.bullet(`Jurisdictional limit: ${dollars(AZ_SMALL_CLAIMS_LIMIT_CENTS)} (A.R.S. § 22-503). Your full claim is ${dollars(full)}; ${full > amount ? `this packet claims ${dollars(amount)} to stay within small claims. Alternatively file a regular civil case in Justice Court (limit $10,000) to claim the full amount.` : "it fits within small claims."}`);
  d.bullet("Filing fee: roughly $30-$50 depending on county (check the precinct's fee schedule). A fee waiver/deferral form is available if needed.");
  d.bullet("Forms: 'Small Claims Complaint' and 'Summons' from the precinct's website. Copy the text in section 2 into the 'Statement of Claim' field.");
  d.bullet("Service: after filing, the court will serve the defendant by certified mail, or you can use a process server. Serve the registered agent if the defendant is a corporation (Arizona Corporation Commission eCorp search: https://ecorp.azcc.gov/; out-of-state entities: their home state's Secretary of State).");
  d.bullet("No attorneys appear in small claims unless both sides agree; hearings are informal. Bring three copies of every exhibit.");

  d.heading("2. Statement of claim (copy into the complaint)", 12);
  d.para(`Plaintiff: ${u.fullName}, ${u.line1}${u.line2 ? ", " + u.line2 : ""}, ${u.city}, ${u.state} ${u.zip}. Phone: ${prettyPhone(u.phone)}.`);
  d.para(`Defendant: ${entity.name}${entity.registered_agent ? `, c/o ${entity.registered_agent.name}, ${entity.registered_agent.address}` : ""}${addr ? `, ${addr.line1}${addr.line2 ? ", " + addr.line2 : ""}, ${addr.city}, ${addr.state} ${addr.zip}` : ""}.`);
  d.para(`Amount claimed: ${dollars(amount)} plus court costs.`);
  const kinds = reports.every((r) => r.kind === "sms") ? "text messages" : "calls and text messages";
  d.para(`Defendant, directly or through agents, sent ${claim.violation_count} unsolicited telemarketing ${kinds} to Plaintiff's personal cellular telephone number ${prettyPhone(u.phone)} between ${fmtDate(reports[0].received_at)} and ${fmtDate(reports[reports.length - 1].received_at)}. Plaintiff never consented to be contacted by Defendant and has no relationship with Defendant.${claim.basis.dnc_eligible ? " Plaintiff's number was registered on the National Do Not Call Registry more than 31 days before the first message." : ""}${claim.basis.tcpa_b3 ? " One or more calls used an artificial or prerecorded voice." : ""} Plaintiff sent Defendant a written demand on ${claim.demand_sent_at ? fmtDate(claim.demand_sent_at) : "[date]"} by certified mail; Defendant did not respond or pay.`);
  d.para(`These communications violate the Telephone Consumer Protection Act, 47 U.S.C. § 227${claim.basis.tcpa_c5 ? "(c)(5) and 47 C.F.R. § 64.1200(c)(2)" : ""}${claim.basis.tcpa_b3 ? `${claim.basis.tcpa_c5 ? "," : ""} § 227(b)(1)(A)(iii) and (b)(3)` : ""}${claim.basis.cfr_1200d ? ", and 47 C.F.R. § 64.1200(d)" : ""}, which provide statutory damages of $500 per violation, and up to $1,500 per violation for willful or knowing conduct. Plaintiff seeks ${dollars(STATUTORY_MAX_CENTS)} per violation (${claim.violation_count} violations), limited to the jurisdictional amount, plus costs. State courts have concurrent jurisdiction over TCPA claims (Mims v. Arrow Financial Services, 565 U.S. 368 (2012)).`);

  d.heading("3. Exhibit list", 12);
  reports.forEach((r, i) => {
    const what = r.kind === "sms" ? "Screenshot of text message" : r.kind === "call" ? "Call log entry" : "Voicemail recording/transcript";
    d.bullet(`Exhibit ${String.fromCharCode(65 + i)}: ${what} from ${prettyPhone(r.sender_phone)}, ${fmtDateTime(r.received_at)}${r.body ? ` — "${r.body.replace(/\s+/g, " ").slice(0, 160)}"` : ""}`);
  });
  const next = String.fromCharCode(65 + reports.length);
  d.bullet(`Exhibit ${next}: Demand letter dated ${claim.demand_sent_at ? fmtDate(claim.demand_sent_at) : "[date]"} with certified mail receipt${claim.lob_letter_id ? ` (Lob letter ${claim.lob_letter_id})` : ""}.`);
  d.bullet(`Exhibit ${String.fromCharCode(66 + reports.length)}: National Do Not Call Registry verification email for ${prettyPhone(u.phone)}.`);
  d.bullet(`Exhibit ${String.fromCharCode(67 + reports.length)}: Phone bill page showing ${prettyPhone(u.phone)} is a cellular number in Plaintiff's name.`);

  d.heading("4. Before the hearing", 12);
  d.bullet("Take screenshots of each message showing the sender number, date and time. Export the call log if calls are involved (the Spamtext app 'Reported' tab has the original timestamps).");
  d.bullet("Print the Do Not Call verification email (donotcall.gov/verify sends it).");
  d.bullet("Check the Arizona Secretary of State telephone solicitor registry; if the defendant is not registered, mention A.R.S. § 44-1272 and § 44-1279 at the hearing.");
  d.bullet("If the defendant offers to settle before the hearing, get it in writing and mark the claim settled with /settled in Telegram.");
  d.para(`Minimum recovery if the court awards the base amount: ${dollars(Math.min(claim.violation_count * STATUTORY_MIN_CENTS, AZ_SMALL_CLAIMS_LIMIT_CENTS))}.`);

  return d.bytes();
}
