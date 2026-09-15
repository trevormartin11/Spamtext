import { env } from "./env";
import { SimpleDoc, fmtDate, fmtDateTime } from "./pdf";
import { dollars, STATUTORY_MAX_CENTS, STATUTORY_MIN_CENTS } from "./assess";
import { prettyPhone } from "./phone";
import type { Claim, Entity, Report } from "./types";

/** Demand amount: treble ($1,500) per violation, the standard opening position. */
export function demandAmountCents(claim: Claim): number {
  return claim.violation_count * STATUTORY_MAX_CENTS;
}

export async function buildDemandLetter(claim: Claim, entity: Entity, reports: Report[]): Promise<{ pdf: Uint8Array; text: string }> {
  const d = await SimpleDoc.create();
  const today = fmtDate(new Date());
  const u = env.user;
  const amount = demandAmountCents(claim);
  const addr = entity.mailing_address;
  const deadline = new Date(); deadline.setDate(deadline.getDate() + 30);

  d.lines([u.fullName, u.line1, ...(u.line2 ? [u.line2] : []), `${u.city}, ${u.state} ${u.zip}`, ...(u.email ? [u.email] : [])]);
  d.para(today);
  d.lines([
    entity.name,
    ...(entity.registered_agent ? [`c/o ${entity.registered_agent.name}`] : []),
    ...(addr ? [addr.line1, ...(addr.line2 ? [addr.line2] : []), `${addr.city}${addr.city ? ", " : ""}${addr.state} ${addr.zip}`.trim()] : []),
    ...(entity.email ? [`Via email: ${entity.email}`] : []),
  ]);
  d.para("SENT VIA USPS CERTIFIED MAIL" + (entity.email ? " AND EMAIL" : ""), { bold: true });
  d.para(`Re: Demand for statutory damages under the Telephone Consumer Protection Act, 47 U.S.C. § 227, and 47 C.F.R. § 64.1200 — unsolicited ${reports.every((r) => r.kind === "sms") ? "text messages" : "calls and text messages"} to ${prettyPhone(u.phone)}`, { bold: true });

  d.para("To whom it may concern:");
  d.para(`I am writing to demand payment of ${dollars(amount)} for ${claim.violation_count} unsolicited telemarketing ${claim.violation_count === 1 ? "communication" : "communications"} that ${entity.name} (or a party acting on its behalf) sent to my personal cellular telephone number, ${prettyPhone(u.phone)}. I never gave ${entity.name} prior express consent, written or otherwise, to contact me. I have no business relationship with ${entity.name} and never inquired about its products or services.`);

  if (claim.basis.dnc_eligible) {
    d.para(`My number has been listed on the National Do Not Call Registry for more than 31 days before the first communication listed below. Under 47 U.S.C. § 227(c)(5) and 47 C.F.R. § 64.1200(c)(2), a person who receives more than one telephone solicitation within any 12-month period by or on behalf of the same entity in violation of the do-not-call regulations may recover $500 for each violation, and up to $1,500 for each violation committed willfully or knowingly. Under Ninth Circuit precedent, text messages are "calls" for purposes of the TCPA.`);
  }
  if (claim.basis.tcpa_b3) {
    d.para("One or more of the calls below used an artificial or prerecorded voice. 47 U.S.C. § 227(b)(1)(A)(iii) prohibits such calls to a cellular number without prior express consent, and § 227(b)(3) provides $500 per call, trebled to $1,500 for willful or knowing violations, independent of any do-not-call registration.");
  }
  if (claim.basis.cfr_1200d) {
    d.para("The messages also fail to identify the seller and provide no functioning method to demand placement on your internal do-not-call list, in violation of 47 C.F.R. § 64.1200(d). Each such message is separately actionable under § 227(c)(5).");
  }
  d.para("In addition, unsolicited telephone solicitations to a mobile device are an unlawful practice under Arizona law, A.R.S. § 44-1282 and § 44-1278, and, if you are not registered with the Arizona Secretary of State as required by A.R.S. § 44-1272, A.R.S. § 44-1279 provides for rescission, actual damages and attorney fees.");

  d.heading("Communications at issue", 12);
  for (const r of reports) {
    const what = r.kind === "sms" ? "Text message" : r.kind === "call" ? `Call${r.prerecorded ? " (prerecorded voice)" : ""}` : `Voicemail${r.prerecorded ? " (prerecorded voice)" : ""}`;
    d.bullet(`${fmtDateTime(r.received_at)} — ${what} from ${prettyPhone(r.sender_phone)}${r.body ? `: "${r.body.replace(/\s+/g, " ").slice(0, 300)}"` : ""}`);
  }

  d.heading("Demand", 12);
  d.para(`To resolve this matter without litigation, I demand payment of ${dollars(amount)} (${claim.violation_count} × ${dollars(STATUTORY_MAX_CENTS)}) within thirty (30) days of the date of this letter, i.e., by ${fmtDate(deadline)}. Payment may be made by check to the address above. I also demand that you (1) immediately add ${prettyPhone(u.phone)} to your internal do-not-call list and the list of every vendor or affiliate that contacts consumers on your behalf, and (2) identify in writing the name and address of every third party that sent the communications above on your behalf.`);
  d.para(`If I do not receive payment by the deadline, I intend to file suit in the Justice Court of ${u.county} County, Arizona, seeking the maximum statutory damages of ${dollars(STATUTORY_MAX_CENTS)} per violation (a minimum of ${dollars(claim.violation_count * STATUTORY_MIN_CENTS)}), together with costs, and to pursue every other remedy available under state and federal law. I will also continue to cooperate with the Federal Communications Commission, the Federal Trade Commission and the Arizona Attorney General, with whom complaints have already been filed.`);
  d.para("This letter is a good-faith attempt to resolve this matter and is written without waiver of any rights or remedies, all of which are expressly reserved. Please preserve all records relating to the communications above, including call and message logs, consent records, lead sources and vendor agreements, as they are relevant to anticipated litigation.");
  d.para("Sincerely,");
  d.space(2);
  d.lines([u.fullName, prettyPhone(u.phone)]);

  const text = `Demand for TCPA statutory damages of ${dollars(amount)} for ${claim.violation_count} unsolicited communication(s) to ${prettyPhone(u.phone)}. See attached letter. Payment due by ${fmtDate(deadline)}.`;
  return { pdf: await d.bytes(), text };
}
