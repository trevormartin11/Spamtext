# Legal basis (Arizona resident, US cell phone)

This is background for how the pipeline decides a claim is worth pursuing. It is not legal advice. Statutes and case law change; verify before filing anything.

## Where the money comes from

Government complaints (FTC, FCC, carrier 7726, Do Not Call) never pay you. They build the public record and occasionally lead to enforcement actions or class settlements. The money comes from the **Telephone Consumer Protection Act (TCPA), 47 U.S.C. § 227**, which lets an individual sue and recover statutory damages without proving any loss.

| Theory | Statute | What you must show | Damages |
|---|---|---|---|
| Do Not Call | § 227(c)(5), 47 C.F.R. § 64.1200(c)(2) | Number on the National DNC Registry ≥ 31 days; **two or more** telemarketing calls/texts within 12 months by or on behalf of the same seller; no prior express consent | $500 per message, up to $1,500 if willful or knowing |
| Prerecorded / artificial voice | § 227(b)(1)(A)(iii), (b)(3) | Any robocall (recorded voice) to a cell phone without prior express consent. One call is enough. No DNC registration needed. | $500 per call, up to $1,500 |
| Internal DNC / identification | 47 C.F.R. § 64.1200(d) | Telemarketing message that fails to identify the seller or offer a do-not-call mechanism. Courts are split on whether one message suffices. | Same via § 227(c)(5) |

**Texts are "calls" in the Ninth Circuit** (which covers Arizona): *Howard v. Republican National Committee* (9th Cir.). The Seventh Circuit held the opposite in July 2026 (*Steidinger v. Blackstone Medical Services*), so a Supreme Court resolution may come. Until then, Arizona plaintiffs can use the DNC theory for texts.

**Autodialer claims** (§ 227(b)(1)(A) "ATDS") are mostly dead after *Facebook v. Duguid* (2021); the pipeline does not rely on them.

## Arizona law

- **A.R.S. § 44-1282** mirrors the TCPA (unsolicited calls to mobile devices, prerecorded messages). **A.R.S. § 44-1278** lists unlawful telephone-solicitation practices. Both are enforced by the Attorney General; they are cited in the demand letter for weight, not as a separate private claim.
- **A.R.S. § 44-1272 / 44-1279**: telephone solicitors must register with the Secretary of State and post a $100,000 bond. If the seller is **not registered**, § 44-1279 gives a private right to rescind, recover actual damages and attorney fees.
- **A.R.S. § 44-1522** (Consumer Fraud Act) has an implied private right of action for deceptive practices; useful if the message is deceptive.

## Small claims in Arizona

- Justice Court small claims division, limit **$3,500** (A.R.S. § 22-503; some 2026 sources say $5,000, so check your precinct). Regular Justice Court civil limit is $10,000 if the claim is bigger.
- Filing fee roughly $30–$50; no attorneys unless both sides agree; informal hearing.
- TCPA claims can be brought in state court (*Mims v. Arrow Financial Services*, 565 U.S. 368 (2012)).
- Serve corporations through their statutory agent (Arizona Corporation Commission eCorp, or the home state's Secretary of State).

## What makes a claim viable in this pipeline

`web/lib/assess.ts` applies these rules:

1. `dnc_eligible` = DNC registration date + 31 days ≤ first message date. Set the date with `/dnc YYYY-MM-DD` in Telegram (verify at https://www.donotcall.gov/verify.html).
2. `tcpa_c5` = dnc_eligible **and** ≥ 2 telemarketing messages from the same entity/number in 12 months.
3. `tcpa_b3` = any call or voicemail tagged "Recorded" in the app.
4. Violation count = every telemarketing message (c5) or every recorded call (b3). Estimated range = count × $500 to count × $1,500. Demand letters ask for $1,500 per violation.

A claim is "not yet viable" after the first text from a seller. The second text from the same seller within a year flips it, and the letter goes out.

## Consent

You told me you won't report anyone you gave your number to, so the app does not ask. Keep that rule: consent is the standard defense and it's a loser to demand money from a company you opted into. Replying STOP is fine and does not count as consent; messages after a STOP are extra-strong evidence.

## Realistic expectations

- Most spam texts come from disposable numbers and lead-gen affiliates; identifying the real seller is the hard part. The pipeline uses carrier lookups, links in the message, domain registration records and an LLM read of the text, and tells you when it needs help.
- Demand letters to identifiable, US-based businesses are frequently settled for a few hundred to a few thousand dollars because litigating costs them more.
- Overseas scammers and phishing texts are not collectable. The pipeline still files complaints for those but does not open a claim when the LLM classifies the text as scam/phishing with no seller.
