import { env } from "./env";
import { db } from "./supabase";
import { ensureBudget, recordSpend } from "./spend";
import { isE164 } from "./phone";
import type { Sender } from "./types";

// Twilio Lookup v2 pricing (USD): line_type_intelligence $0.008, caller_name $0.01 per request.
const LINE_TYPE_CENTS = 1;   // rounded up
const CALLER_NAME_CENTS = 1;

export interface LookupResult {
  line_type: string | null;
  carrier: string | null;
  caller_name: string | null;
  caller_type: string | null;
  raw: unknown;
}

/** Twilio Lookup v2 for a US number. Returns null when not configured or number is not E.164. */
export async function twilioLookup(phone: string): Promise<LookupResult | null> {
  if (!env.twilioSid || !env.twilioToken) return null;
  if (!isE164(phone)) return null;
  await ensureBudget(LINE_TYPE_CENTS + CALLER_NAME_CENTS);
  const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phone)}?Fields=line_type_intelligence,caller_name`;
  const auth = Buffer.from(`${env.twilioSid}:${env.twilioToken}`).toString("base64");
  const r = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!r.ok) throw new Error(`Twilio lookup failed ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as {
    line_type_intelligence?: { type?: string; carrier_name?: string } | null;
    caller_name?: { caller_name?: string; caller_type?: string } | null;
  };
  await recordSpend("twilio_lookup", LINE_TYPE_CENTS + CALLER_NAME_CENTS, `Lookup ${phone}`);
  return {
    line_type: j.line_type_intelligence?.type ?? null,
    carrier: j.line_type_intelligence?.carrier_name ?? null,
    caller_name: j.caller_name?.caller_name ?? null,
    caller_type: j.caller_name?.caller_type ?? null,
    raw: j,
  };
}

/** Ensure a sender row exists and has been looked up (once). */
export async function ensureSender(phone: string): Promise<Sender> {
  const supa = db();
  const { data: existing } = await supa.from("senders").select("*").eq("phone", phone).maybeSingle();
  let sender = existing as Sender | null;
  if (!sender) {
    const { data, error } = await supa
      .from("senders")
      .insert({ phone, is_short_code: /^\d{4,6}$/.test(phone) })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    sender = data as Sender;
  }
  if (!sender.looked_up_at) {
    try {
      const res = await twilioLookup(phone);
      const patch = res
        ? { line_type: res.line_type, carrier: res.carrier, caller_name: res.caller_name, lookup_json: res.raw, looked_up_at: new Date().toISOString() }
        : { looked_up_at: new Date().toISOString() };
      const { data } = await supa.from("senders").update(patch).eq("id", sender.id).select("*").single();
      if (data) sender = data as Sender;
    } catch (e) {
      // Budget or API failure: leave looked_up_at null so we retry tomorrow.
      console.warn("lookup skipped", (e as Error).message);
    }
  }
  return sender;
}
