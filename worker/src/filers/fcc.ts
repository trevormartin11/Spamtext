import type { Page } from "playwright";
import { DRY_RUN, user, describe, digits10, localParts, passCloudflare, type Job, type FileResult } from "../common.js";

const FORM = "https://consumercomplaints.fcc.gov/hc/en-us/requests/new?ticket_form_id=39744";

/** FCC "Type of Property, Goods, or Services" tag values by our category (others fall back to other_services). */
const GOODS: Record<string, string> = {
  auto_warranty: "auto_warranty_services", debt_relief: "debt_relief/debt_consolidation_services", loans: "credit_card_debt_services",
  medical: "health_insurance_services", insurance: "health_insurance_services", home_services: "home_improvement_services",
};

/** Zendesk "tagger" dropdowns are hidden inputs; set the value and fire change so conditional fields appear. */
async function tag(page: Page, id: string, value: string): Promise<void> {
  const ok = await page.evaluate(([i, v]) => {
    const el = document.getElementById("request_custom_fields_" + i) as HTMLInputElement | null;
    if (!el) return false;
    el.value = v;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, [id, value]);
  if (!ok) throw new Error(`FCC field ${id} not found (form layout changed?)`);
  await page.waitForTimeout(300);
}
async function text(page: Page, id: string, value: string): Promise<void> {
  const loc = page.locator(`#request_custom_fields_${id}`);
  if ((await loc.count()) === 0) return;
  await loc.fill(value).catch(() => {});
}

/**
 * FCC Consumer Complaint Center, "Phone" form. The site sits behind a Cloudflare challenge that
 * headless datacenter browsers usually cannot pass; from a home machine with HEADLESS=0 it typically does.
 */
export async function fileFcc(page: Page, job: Job): Promise<FileResult> {
  const r = job.reports;
  const parts = localParts(r.received_at);
  const entity = r.senders?.entities ?? null;

  await page.goto(FORM, { waitUntil: "domcontentloaded" });
  if (!(await passCloudflare(page))) {
    throw new Error("Cloudflare challenge blocked the FCC complaint form. Run the worker from a home computer (HEADLESS=0 npm start) or file it by hand: " + FORM);
  }
  await page.locator("form#new_request").waitFor({ state: "visible", timeout: 30000 });

  await page.locator("#request_anonymous_requester_email").fill(user.email);
  await page.locator("#request_subject").fill(`Unwanted ${r.kind === "sms" ? "text message" : "call"} from ${r.sender_phone}`);
  await page.locator("#request_description").fill(describe(job));

  await tag(page, "22619354", "telemarketing_phone");
  await tag(page, "360000167206", "phone_unwanted_calls_all_other_unwanted_calls");
  await tag(page, "22787840", r.kind === "sms" ? "text_messaage_type_of_call_telemarketing" : r.prerecorded === false ? "live_voice_type_of_call_telemarketing" : "prerecorded_voice_type_of_call_telemarketing");
  await tag(page, "22625554", "yes_telemarketing_services");
  await tag(page, "22787930", "no_business_relationship_part_1");
  await tag(page, "22787940", "no_business_relationship_part_2");
  await tag(page, "22629554", "no_personal_relationship");
  const goods = GOODS[r.category ?? ""] ?? "other_services";
  await tag(page, "360046689972", goods);
  if (goods === "other_services") await text(page, "22659794", (r.category ?? "unsolicited marketing").replace(/_/g, " "));
  await tag(page, "22625574", "no_permission_to_call");
  await tag(page, "22630454", entity?.name ? "yes_advertiser_business_name_provided" : "no_advertiser_business_name_provided");
  if (entity?.name) await text(page, "22659904", entity.name);
  await tag(page, "22787920", "yes_caller_id_information");
  await text(page, "22659864", digits10(r.sender_phone));
  if (r.senders?.caller_name) await text(page, "22659874", r.senders.caller_name);
  await tag(page, "22787860", "yes_do_not_call_list");
  await tag(page, "52026458923796", r.category === "scam_phishing" ? "yes_imposter" : "no_imposter");
  await tag(page, "22659804", "residential_personal_phone_type_location");
  await tag(page, "22781220", "wireless_phone");
  await text(page, "22625614", digits10(user.phone).replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3"));
  await text(page, "22664804", digits10(r.sender_phone).replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3"));
  await text(page, "22591154", parts.date);
  await page.keyboard.press("Escape");
  await text(page, "22732340", parts.time12);
  await text(page, "22664784", r.body ? `Message text: ${r.body.slice(0, 1500)}` : "");
  await text(page, "22539594", user.firstName);
  await text(page, "22704720", user.lastName);
  await text(page, "22554824", user.line1);
  await text(page, "22554844", user.city);
  await tag(page, "22540114", (user.state in STATE_TAGS ? STATE_TAGS[user.state] : user.state.toLowerCase()));
  await text(page, "22540124", user.zip);
  await text(page, "22615094", digits10(user.phone));
  await tag(page, "22636844", "no_filing_on_behalf");
  await page.locator("#request_custom_fields_22625624").check().catch(() => {});

  const submit = page.locator('input[type=submit][name=commit]');
  await submit.waitFor({ state: "visible" });
  if (DRY_RUN) return { confirmation: null, note: "dry run: form filled, not submitted" };
  await submit.click();
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  const body = await page.locator("body").innerText().catch(() => "");
  const m = body.match(/(?:request|ticket)\s*#?\s*(\d{5,})/i);
  if (/error|there was a problem|is required/i.test(body) && !m) throw new Error("FCC form did not confirm: " + body.slice(0, 200));
  return { confirmation: m?.[1] ?? null, note: m ? undefined : "submitted; no ticket number visible (check the confirmation email)" };
}

const STATE_TAGS: Record<string, string> = Object.fromEntries(
  Object.entries({
    AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut", DE: "delaware", DC: "district_of_columbia",
    FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine",
    MD: "maryland", MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada",
    NH: "new_hampshire", NJ: "new_jersey", NM: "new_mexico", NY: "new_york", NC: "north_carolina", ND: "north_dakota", OH: "ohio", OK: "oklahoma", OR: "oregon",
    PA: "pennsylvania", RI: "rhode_island", SC: "south_carolina", SD: "south_dakota", TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont", VA: "virginia",
    WA: "washington", WV: "west_virginia", WI: "wisconsin", WY: "wyoming",
  }),
);
