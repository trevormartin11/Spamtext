/**
 * Drives the FTC and DNC filers against the live sites with a synthetic report in DRY_RUN mode
 * (never submits) and saves screenshots to ./screenshots. Usage: DRY_RUN=1 npx tsx src/selftest.ts [ftc|dnc|fcc]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { HEADLESS, opt, type Job } from "./common.js";
import { fileFtc } from "./filers/ftc.js";
import { fileFcc } from "./filers/fcc.js";
import { fileDnc } from "./filers/dnc.js";

if (process.env.DRY_RUN !== "1") { console.error("Refusing to run the self-test without DRY_RUN=1"); process.exit(2); }
const which = (process.argv[2] ?? "ftc,dnc").split(",");
const job = (kind: "sms" | "call"): Job => ({
  id: "selftest", report_id: "selftest", agency: "ftc", attempts: 0,
  reports: {
    id: "selftest", kind, sender_phone: "+16025550199", body: kind === "sms" ? "Hi! You've been pre-approved for $5,000 in debt relief. Reply YES or visit http://example-relief.test to claim. Reply STOP to end" : null,
    received_at: new Date(Date.now() - 3600_000).toISOString(), prerecorded: kind === "call" ? true : null, category: "debt_relief",
    senders: { caller_name: null, carrier: null, entities: { name: "Example Relief LLC", website: "https://example-relief.test" } },
  },
});
mkdirSync("screenshots", { recursive: true });
const browser = await chromium.launch({ headless: HEADLESS, executablePath: opt("CHROMIUM_PATH") || undefined, args: opt("CHROMIUM_ARGS").split(" ").filter(Boolean) });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
for (const w of which) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  try {
    const res = w === "ftc" ? await fileFtc(page, job("sms")) : w === "ftc-call" ? await fileFtc(page, job("call")) : w === "dnc" ? await fileDnc(page, job("call")) : await fileFcc(page, job("sms"));
    console.log(w, "OK", res);
  } catch (e) {
    console.error(w, "FAILED", (e as Error).message);
  }
  await page.screenshot({ path: `screenshots/${w}.png`, fullPage: true }).catch(() => {});
  await page.close();
}
await browser.close();
