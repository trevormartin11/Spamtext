import type { Page } from "playwright";
import { DRY_RUN, user, describe, digits10, localParts, type Job, type FileResult } from "../common.js";

/** donotcall.gov "What was the call about?" option values by our category. */
const SUBJECT: Record<string, string> = {
  debt_relief: "3", loans: "3", scam_phishing: "4", medical: "5", insurance: "5", solar: "9", home_services: "10",
  job_offer: "11", auto_warranty: "12", gambling: "13", political: "15", real_estate: "1",
};

/** jQuery-driven radios on donotcall.gov ignore Playwright's check(); set them the way the page expects. */
async function radio(page: Page, id: string): Promise<void> {
  await page.evaluate((sel) => {
    const $ = (window as unknown as { $: (s: string) => { prop: (k: string, v: boolean) => { trigger: (e: string) => { trigger: (e: string) => void } } } }).$;
    $(sel).prop("checked", true).trigger("click").trigger("change");
  }, "#" + id);
}

/**
 * National Do Not Call Registry complaint (donotcall.gov/report.html). Only accepts calls;
 * for texts the site itself redirects to FTC ReportFraud, which we file separately.
 */
export async function fileDnc(page: Page, job: Job): Promise<FileResult> {
  const r = job.reports;
  if (r.kind === "sms") return { confirmation: null, skipped: true, note: "donotcall.gov does not accept text-message complaints (it redirects to FTC ReportFraud, which is filed separately)" };
  const parts = localParts(r.received_at);

  await page.goto("https://www.donotcall.gov/report.html", { waitUntil: "domcontentloaded" });
  await page.locator("#MainContinueButton").waitFor({ state: "visible" });
  await page.locator("#MainContinueButton").click();

  await page.locator("#PhoneTextBox").waitFor({ state: "visible" });
  await page.locator("#PhoneTextBox").fill(digits10(user.phone));
  await page.locator("#DateOfCallTextBox").fill(parts.date);
  await page.keyboard.press("Escape");
  await page.locator("#TimeOfCallDropDownList").selectOption(parts.hour24).catch(() => {});
  await page.locator("#ddlMinutes").selectOption(parts.minute).catch(() => {});
  await radio(page, r.prerecorded === false ? "PrerecordMessageNORadioButton" : "PrerecordMessageYESRadioButton");
  await radio(page, "PhoneCallRadioButton");
  await page.locator("#ddlSubjectMatter").selectOption(SUBJECT[r.category ?? ""] ?? "1").catch(() => {});
  if (!SUBJECT[r.category ?? ""]) await page.locator("#txtSubjectMatter").fill((r.category ?? "unsolicited call").replace(/_/g, " ").slice(0, 50)).catch(() => {});
  await page.locator("#StepOneContinueButton").click();

  await page.locator("#CallerPhoneNumberTextBox").waitFor({ state: "visible" });
  await page.locator("#CallerPhoneNumberTextBox").fill(digits10(r.sender_phone));
  if (r.senders?.entities?.name) await page.locator("#CallerNameTextBox").fill(r.senders.entities.name.slice(0, 100));
  await radio(page, "HaveBusinessNoRadioButton");
  await radio(page, "StopCallingNoRadioButton");
  await page.locator("#FirstNameTextBox").fill(user.firstName);
  await page.locator("#LastNameTextBox").fill(user.lastName);
  await page.locator("#StreetAddressTextBox").fill(user.line1);
  await page.locator("#CityTextBox").fill(user.city);
  await page.locator("#StateDropDownList").selectOption(user.state).catch(() => {});
  await page.locator("#ZipCodeTextBox").fill(user.zip);
  await page.locator("#CommentTextBox").fill(describe(job).slice(0, 1000));

  const submit = page.locator("#StepTwoSubmitButton");
  await submit.waitFor({ state: "visible" });
  if (DRY_RUN) return { confirmation: null, note: "dry run: filled through step 2, not submitted" };
  await submit.click();
  await page.locator("#step3, #confirmcontent").first().waitFor({ state: "visible", timeout: 30000 });
  const text = await page.locator("body").innerText().catch(() => "");
  const m = text.match(/(?:reference|confirmation)\s*(?:number|#)[:\s#]*([A-Z0-9-]{5,})/i);
  return { confirmation: m?.[1] ?? null };
}
