import type { Page } from "playwright";
import { DRY_RUN, user, describe, digits10, localParts, STATE_NAMES, type Job, type FileResult } from "../common.js";

/** FTC "What was the call about?" labels by our category. */
const ROBO_ABOUT: Record<string, string> = {
  debt_relief: "Reducing your debt", loans: "Reducing your debt", solar: "Energy, solar, & utilities", home_services: "Home improvement & cleaning",
  auto_warranty: "Warranties & protection plans", medical: "Medical & prescriptions", insurance: "Medical & prescriptions",
  job_offer: "Work from home & other ways to make money", gambling: "Lotteries, prizes & sweepstakes",
  scam_phishing: "Calls pretending to be government, businesses, or family and friends", real_estate: "Other", political: "Other",
};

const CONTINUE = 'a[role=button]:has-text("Continue")';

async function setCheckbox(page: Page, id: string): Promise<void> {
  const input = page.locator("#" + id);
  if (!(await input.isVisible().catch(() => false))) return;
  if (await input.isChecked()) return;
  await input.click({ force: true }).catch(() => {});
  if (!(await input.isChecked())) await page.locator(`label[for="${id}"]`).first().click().catch(() => {});
}

/** Angular radios: click the input, fall back to its label, then verify. */
async function setRadio(page: Page, id: string): Promise<void> {
  const input = page.locator("#" + id);
  await input.waitFor({ state: "visible" });
  await input.click({ force: true }).catch(() => {});
  if (!(await input.isChecked())) await page.locator(`label[for="${id}"]`).first().click().catch(() => {});
  if (!(await input.isChecked())) await input.check();
}

/**
 * FTC ReportFraud (reportfraud.ftc.gov). Texts go through "Something else" (the site's own spam-text path);
 * calls and voicemails through "Just an annoying call".
 */
export async function fileFtc(page: Page, job: Job): Promise<FileResult> {
  const r = job.reports;
  const isText = r.kind === "sms";
  const parts = localParts(r.received_at);
  const entity = r.senders?.entities ?? null;

  await page.goto("https://reportfraud.ftc.gov/assistant", { waitUntil: "domcontentloaded" });
  await page.locator(isText ? "#cat-11 label" : "#cat-10 label").first().click();
  await page.locator("button#continueBtn:visible").click();
  await page.waitForURL(/\/form\/main/, { timeout: 20000 });

  // The details section renders a "Loading....." overlay while option lists are fetched; wait it out.
  await page.getByText(/^Loading/).first().waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
  await page.locator("textarea[formcontrolname=comments]").waitFor({ state: "visible" });

  if (isText) {
    await page.locator("#rdcontact option").nth(2).waitFor({ state: "attached", timeout: 30000 });
    await page.locator("textarea[formcontrolname=comments]").fill(describe(job).slice(0, 3400));
    await setRadio(page, "yes-or-no-money-no");
    // "No" reveals "Were you asked to pay or send money?" and collapses the form onto one page.
    if (await page.locator("#yes-or-no-asked-money-no").isVisible().catch(() => false)) {
      const asked = /\$\d|pay|fee|invoice|owe|bill/i.test(r.body ?? "");
      await setRadio(page, asked ? "yes-or-no-asked-money-yes" : "yes-or-no-asked-money-no");
    }
    await page.locator("#rdcontact").selectOption({ label: "Text" });
    await page.locator("#mobile-check-one").waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    await setCheckbox(page, "mobile-check-one");
    if (/\bstop\b/i.test(r.body ?? "") && /still|again|after/i.test(r.body ?? "")) await setCheckbox(page, "mobile-check-two");
    await page.locator("#rdphone").fill(digits10(r.sender_phone) || r.sender_phone);
    const first = page.locator("#rddatetwo");
    if (await first.isVisible().catch(() => false)) { await first.click(); await first.pressSequentially(parts.date, { delay: 20 }); await page.keyboard.press("Tab"); }
    if (entity?.name) await page.locator("#rcname").fill(entity.name.slice(0, 100));
    if (entity?.website) {
      await setRadio(page, "yes-or-no-contact-yes");
      await page.locator("#rccountry").selectOption({ label: "USA" }).catch(() => {});
      await page.locator("#rcwebsite").fill(entity.website.slice(0, 200));
    }
    // Two-step layout: advance; single-page layout: "About you" is already on screen.
    if (!(await page.locator("#rayfirstName").isVisible().catch(() => false))) {
      await page.locator('a[role=button]:has-text("Continue")').first().click();
    }
    await page.locator("#rayfirstName").waitFor({ state: "visible" });
    await page.locator("#rayfirstName").fill(user.firstName);
    await page.locator("#raylastName").fill(user.lastName);
    await page.locator("#raycountry").selectOption({ label: "USA" }).catch(() => {});
    await page.locator("#reportAboutYouAddress").fill(user.line1);
    await page.locator("#raycity").fill(user.city);
    // After choosing USA the free-text region box becomes a state <select>.
    const stateSel = page.locator("#raystate");
    if (await stateSel.isVisible().catch(() => false)) await stateSel.selectOption({ label: STATE_NAMES[user.state] ?? user.state }).catch(() => {});
    else await page.locator("#rayotherState").fill(STATE_NAMES[user.state] ?? user.state).catch(() => {});
    await page.locator("#USZipCode").fill(user.zip);
    await page.locator("#rayphone").fill(digits10(user.phone));
    await page.locator("#rayphoneType").selectOption({ label: "Cell phone" }).catch(() => {});
    if (user.email) await page.locator("#rayemail").fill(user.email);
  } else {
    await setRadio(page, r.prerecorded === false ? "yes-or-no-robo-no" : "yes-or-no-robo-yes");
    await page.locator("#robordrobophone").fill(digits10(user.phone));
    await page.locator("#robordabout").selectOption({ label: ROBO_ABOUT[r.category ?? ""] ?? "Other" }).catch(() => {});
    await page.locator("#robordroboDate").fill(parts.date);
    await page.keyboard.press("Escape");
    await page.locator("#robordroboHour").selectOption({ label: parts.hourLabel }).catch(() => {});
    await page.locator("#robordroboMinute").selectOption({ label: parts.minute }).catch(() => {});
    await setRadio(page, "yes-or-no-contact-dnc-no");
    await setRadio(page, "yes-or-no-stop-no");
    if (entity?.name) await page.locator("#roborcname").fill(entity.name.slice(0, 100));
    await page.locator("#roborcroboCallerId").fill(digits10(r.sender_phone) || r.sender_phone);
    await page.locator("textarea[formcontrolname=comments]").fill(describe(job).slice(0, 990));
    await page.locator(CONTINUE).click();
    await page.locator("#rayrobofirstName").waitFor({ state: "visible" });
    await page.locator("#rayrobofirstName").fill(user.firstName);
    await page.locator("#rayrobolastName").fill(user.lastName);
    await page.locator("#rayroboaddress").fill(user.line1);
    await page.locator("#rayrobocity").fill(user.city);
    await page.locator("#rayrobostate").selectOption({ label: STATE_NAMES[user.state] ?? user.state }).catch(() => {});
    await page.locator("#rayrobozipCode").fill(user.zip);
  }

  const submit = page.locator('button:has-text("Submit")').first();
  await submit.waitFor({ state: "visible" });
  if (DRY_RUN) return { confirmation: null, note: "dry run: filled through the final page, not submitted" };
  await submit.click();
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const text = await page.locator("body").innerText().catch(() => "");
  if (/error|try again/i.test(text) && !/report (number|id)/i.test(text)) throw new Error("FTC did not confirm submission: " + text.slice(0, 200));
  const m = text.match(/(?:report|reference)\s*(?:number|id|#)[:\s#]*([A-Z0-9-]{5,})/i);
  return { confirmation: m?.[1] ?? null, note: m ? undefined : "submitted; no reference number found on the confirmation page" };
}
