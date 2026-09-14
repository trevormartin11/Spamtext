import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Page } from "playwright";


let _supa: SupabaseClient | null = null;
/** Lazy service-role client so the self-test can run without Supabase credentials. */
export function supa(): SupabaseClient {
  if (!_supa) _supa = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  return _supa;
}
export const DRY_RUN = process.env.DRY_RUN === "1";
export const HEADLESS = process.env.HEADLESS !== "0";

function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
}
export function opt(k: string, d = ""): string { return process.env[k] ?? d; }

export const user = {
  fullName: opt("USER_FULL_NAME", "Consumer"),
  firstName: opt("USER_FULL_NAME", "Consumer").split(" ")[0],
  lastName: opt("USER_FULL_NAME", "Consumer").split(" ").slice(1).join(" ") || "-",
  phone: opt("USER_PHONE"),
  phoneDigits: opt("USER_PHONE").replace(/\D/g, "").replace(/^1(\d{10})$/, "$1"),
  email: opt("USER_EMAIL"),
  line1: opt("USER_ADDRESS_LINE1"),
  city: opt("USER_CITY"),
  state: opt("USER_STATE", "AZ"),
  zip: opt("USER_ZIP"),
};

export interface Job {
  id: string; report_id: string; agency: "ftc" | "fcc" | "dnc"; attempts: number;
  reports: {
    id: string; kind: string; sender_phone: string; body: string | null; received_at: string; prerecorded: boolean | null;
    category: string | null; senders: { caller_name: string | null; carrier: string | null; entities: { name: string; website: string | null } | null } | null;
  };
}

export interface FileResult { confirmation: string | null; note?: string; skipped?: boolean }

export function prettyPhone(p: string): string {
  const m = p.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : p;
}
export function digits10(p: string): string {
  const d = p.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

export function describe(job: Job): string {
  const r = job.reports;
  const when = new Date(r.received_at).toLocaleString("en-US", { timeZone: "America/Phoenix" });
  const who = r.senders?.entities?.name ? ` The sender appears to be ${r.senders.entities.name}${r.senders.entities.website ? ` (${r.senders.entities.website})` : ""}.` : "";
  const kind = r.kind === "sms" ? "unsolicited text message" : r.kind === "call" ? `unsolicited ${r.prerecorded ? "prerecorded robocall" : "telemarketing call"}` : `unsolicited ${r.prerecorded ? "prerecorded" : ""} voicemail`;
  return `I received an ${kind} on ${when} from ${prettyPhone(r.sender_phone)} on my personal cell phone (${prettyPhone(user.phone)}), which is on the National Do Not Call Registry. I never gave consent and have no relationship with the sender.${who}${r.body ? ` Message text: "${r.body.replace(/\s+/g, " ").slice(0, 900)}"` : ""}`;
}

export async function uploadShot(path: string, png: Buffer): Promise<string | null> {
  if (!png.length) return null;
  const { error } = await supa().storage.from("documents").upload(path, png, { contentType: "image/png", upsert: true });
  return error ? null : path;
}

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** Arizona-local date parts for a report timestamp. */
export function localParts(iso: string): { date: string; hourLabel: string; minute: string; hour24: string; time12: string } {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const h = Number(p.hour) % 24;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "AM" : "PM";
  return { date: `${p.month}/${p.day}/${p.year}`, hourLabel: `${h12}:00 ${ampm}`, minute: p.minute, hour24: String(h).padStart(2, "0"), time12: `${h12}:${p.minute} ${ampm.toLowerCase()}` };
}

/** Wait for a Cloudflare "Just a moment" challenge to clear; returns false if it never does. */
export async function passCloudflare(page: Page, ms = 45000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const title = await page.title().catch(() => "");
    const challenged = /just a moment|attention required|security verification/i.test(title) || (await page.locator("iframe[src*='challenges.cloudflare.com']").count()) > 0;
    if (!challenged) return true;
    await page.waitForTimeout(2000);
  }
  return false;
}

/** Fill the first matching selector from a list; returns which one worked. */
export async function fillAny(page: Page, selectors: string[], value: string, timeout = 8000): Promise<string> {
  for (const s of selectors) {
    const loc = page.locator(s).first();
    try { await loc.waitFor({ state: "visible", timeout }); await loc.fill(value); return s; } catch { /* try next */ }
  }
  throw new Error(`No selector matched for fill: ${selectors.join(" | ")}`);
}
export async function clickAny(page: Page, selectors: string[], timeout = 8000): Promise<string> {
  for (const s of selectors) {
    const loc = page.locator(s).first();
    try { await loc.waitFor({ state: "visible", timeout }); await loc.click(); return s; } catch { /* try next */ }
  }
  throw new Error(`No selector matched for click: ${selectors.join(" | ")}`);
}
export async function selectAny(page: Page, selectors: string[], value: string | { label: string }, timeout = 8000): Promise<string> {
  for (const s of selectors) {
    const loc = page.locator(s).first();
    try { await loc.waitFor({ state: "visible", timeout }); await loc.selectOption(value); return s; } catch { /* try next */ }
  }
  throw new Error(`No selector matched for select: ${selectors.join(" | ")}`);
}
