import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { env } from "./env";
import { db } from "./supabase";
import { ensureBudget, recordSpend } from "./spend";
import { logEvent } from "./events";
import type { Entity, Extraction, Report, Sender, MailingAddress } from "./types";

const ExtractionSchema = z.object({
  is_marketing: z.boolean().describe("True if the message advertises, sells, or solicits (telemarketing), including lead-gen and 'reply YES' hooks. False for pure phishing/scam with no seller, 2FA codes, personal messages."),
  category: z.string().describe("One of: debt_relief, insurance, solar, home_services, real_estate, auto_warranty, political, loans, medical, job_offer, gambling, crypto, retail, subscription, scam_phishing, other"),
  company_name: z.string().nullable().describe("The business that appears to be behind the message, if identifiable. Null if not."),
  brand_mentions: z.array(z.string()),
  urls: z.array(z.string()).describe("Every URL or bare domain in the message, as written."),
  domains: z.array(z.string()).describe("Registrable domains derived from the URLs, lowercase, e.g. example.com"),
  opt_out_offered: z.boolean().describe("True if the message tells the recipient how to stop (STOP, opt-out link)."),
  identifies_sender: z.boolean().describe("True if the message names the company sending it."),
  summary: z.string().describe("One sentence describing what the message is trying to do."),
});

const SYSTEM = `You analyze unsolicited SMS messages, call transcripts and voicemail transcripts received by a consumer in Arizona, USA.
Your job is to extract facts that help identify the business responsible and whether it is telemarketing.
Only report a company_name if the text supports it; never guess a well-known brand from vague hints.`;

// Anthropic pricing for claude-opus-5 is $5/M input, $25/M output; a message this size costs well under a cent.
const LLM_EST_CENTS = 1;

function client(): Anthropic | null {
  return env.anthropicKey ? new Anthropic({ apiKey: env.anthropicKey }) : null;
}

/** Cheap regex fallback when no Anthropic key is configured. */
function heuristicExtraction(body: string): Extraction {
  const urls = Array.from(body.matchAll(/\b((?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?)/gi)).map((m) => m[1]);
  const domains = Array.from(new Set(urls.map(registrableDomain).filter((d): d is string => !!d)));
  const marketingWords = /\b(offer|discount|save|free|quote|rate|loan|approved|insurance|solar|warranty|debt|reply\s+yes|limited time|act now|click|claim)\b/i;
  return {
    is_marketing: marketingWords.test(body),
    category: "other",
    company_name: null,
    brand_mentions: [],
    urls,
    domains,
    opt_out_offered: /\bstop\b|opt[- ]?out|unsubscribe/i.test(body),
    identifies_sender: false,
    summary: body.slice(0, 120),
  };
}

export function registrableDomain(urlOrDomain: string): string | null {
  try {
    const u = urlOrDomain.includes("://") ? new URL(urlOrDomain) : new URL("http://" + urlOrDomain);
    const host = u.hostname.toLowerCase();
    const parts = host.split(".");
    if (parts.length < 2) return null;
    // crude: handle co.uk-style suffixes minimally
    const two = parts.slice(-2).join(".");
    if (/^(co|com|org|net|gov)\.[a-z]{2}$/.test(two) && parts.length >= 3) return parts.slice(-3).join(".");
    return two;
  } catch {
    return null;
  }
}

export async function extractFacts(report: Report, sender: Sender): Promise<Extraction> {
  const body = report.body ?? "";
  const c = client();
  if (!c || !body.trim()) return heuristicExtraction(body);
  try {
    await ensureBudget(LLM_EST_CENTS);
  } catch (e) {
    await logEvent("LLM extraction skipped: " + (e as Error).message, { reportId: report.id, level: "warn" });
    return heuristicExtraction(body);
  }
  const context = [
    `Kind: ${report.kind}`,
    `Sender: ${report.sender_phone}${sender.caller_name ? ` (carrier caller-name: ${sender.caller_name})` : ""}${sender.line_type ? ` line type: ${sender.line_type}` : ""}${sender.carrier ? ` carrier: ${sender.carrier}` : ""}`,
    `Received: ${report.received_at}`,
    `Message:\n${body}`,
  ].join("\n");
  const res = await c.messages.parse({
    model: "claude-opus-5",
    max_tokens: 2000,
    system: SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(ExtractionSchema) },
    messages: [{ role: "user", content: context }],
  });
  await recordSpend("anthropic", LLM_EST_CENTS, `Extraction for report ${report.id}`);
  if (res.stop_reason === "refusal" || !res.parsed_output) {
    await logEvent("LLM extraction returned no result, using heuristic", { reportId: report.id, level: "warn" });
    return heuristicExtraction(body);
  }
  const out = res.parsed_output;
  out.domains = Array.from(new Set([...out.domains, ...out.urls.map(registrableDomain).filter((d): d is string => !!d)]));
  return out;
}

/** RDAP (free) registrant lookup for a domain; most are privacy-redacted but registrar + creation date still help. */
export async function rdapDomain(domain: string): Promise<{ registrar?: string; registered?: string; org?: string; address?: string } | null> {
  try {
    const r = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { headers: { accept: "application/rdap+json" }, redirect: "follow" });
    if (!r.ok) return null;
    const j = (await r.json()) as { entities?: { roles?: string[]; vcardArray?: unknown[]; entities?: unknown[] }[]; events?: { eventAction: string; eventDate: string }[] };
    const out: { registrar?: string; registered?: string; org?: string; address?: string } = {};
    for (const ev of j.events ?? []) if (ev.eventAction === "registration") out.registered = ev.eventDate;
    const walk = (ents: { roles?: string[]; vcardArray?: unknown[]; entities?: unknown[] }[]) => {
      for (const e of ents) {
        const roles = e.roles ?? [];
        const vcard = (e.vcardArray?.[1] as unknown[][] | undefined) ?? [];
        const get = (k: string) => vcard.find((v) => v[0] === k)?.[3];
        if (roles.includes("registrar")) out.registrar = String(get("fn") ?? out.registrar ?? "");
        if (roles.includes("registrant")) {
          const org = get("org") ?? get("fn");
          if (org && !/redacted|privacy|proxy/i.test(String(org))) out.org = String(org);
          const adr = get("adr");
          if (Array.isArray(adr)) {
            const a = adr.filter(Boolean).join(", ");
            if (a && !/redacted|privacy/i.test(a)) out.address = a;
          }
        }
        if (Array.isArray(e.entities)) walk(e.entities as typeof ents);
      }
    };
    walk(j.entities ?? []);
    return out;
  } catch {
    return null;
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Resolve (or create) the entity for a report. Returns null when there is nothing to go on.
 * Confidence roughly: named in message + domain = 0.8, domain only = 0.5, caller-name only = 0.4.
 */
export async function resolveEntity(report: Report, sender: Sender, facts: Extraction): Promise<Entity | null> {
  const supa = db();
  if (sender.entity_id) {
    const { data } = await supa.from("entities").select("*").eq("id", sender.entity_id).maybeSingle();
    if (data) return data as Entity;
  }
  const domain = facts.domains[0] ?? null;
  const name = facts.company_name ?? facts.brand_mentions[0] ?? (sender.caller_name && !/^(unknown|wireless caller|unavailable)$/i.test(sender.caller_name) ? sender.caller_name : null);
  if (!domain && !name) return null;

  // Find existing by domain, then by name.
  let entity: Entity | null = null;
  if (domain) {
    const { data } = await supa.from("entities").select("*").ilike("domain", domain).maybeSingle();
    if (data) entity = data as Entity;
  }
  if (!entity && name) {
    const { data } = await supa.from("entities").select("*").ilike("name", name).maybeSingle();
    if (data) entity = data as Entity;
  }

  const sources: Entity["sources"] = [];
  let confidence = 0;
  if (facts.company_name) { confidence += 0.5; sources.push({ type: "message_text", note: `Named in message: ${facts.company_name}` }); }
  if (domain) { confidence += 0.3; sources.push({ type: "message_url", note: `Link domain: ${domain}` }); }
  if (sender.caller_name && !facts.company_name) { confidence += 0.4; sources.push({ type: "caller_name", note: `Carrier caller-name: ${sender.caller_name}` }); }
  let rdapAddress: MailingAddress | null = null;
  let registrantOrg: string | null = null;
  if (domain) {
    const rd = await rdapDomain(domain);
    if (rd) {
      sources.push({ type: "rdap", url: `https://rdap.org/domain/${domain}`, note: `registrar=${rd.registrar ?? "?"} registered=${rd.registered ?? "?"}${rd.org ? ` registrant=${rd.org}` : ""}` });
      if (rd.org) { registrantOrg = rd.org; confidence += 0.2; }
      if (rd.address) rdapAddress = { line1: rd.address, city: "", state: "", zip: "", source: "rdap" };
    }
  }
  confidence = Math.min(1, confidence);

  if (!entity) {
    const { data, error } = await supa
      .from("entities")
      .insert({
        name: name ?? registrantOrg ?? domain!,
        aliases: [name, registrantOrg, ...facts.brand_mentions].filter((x): x is string => !!x).map(slug),
        domain, website: domain ? `https://${domain}` : null,
        mailing_address: rdapAddress, confidence, sources,
      })
      .select("*").single();
    if (error) throw new Error(error.message);
    entity = data as Entity;
    await logEvent(`Entity created: ${entity.name} (confidence ${confidence.toFixed(2)})`, { reportId: report.id });
  } else if (!entity.manual) {
    // Merge new evidence
    const merged = {
      confidence: Math.max(entity.confidence, confidence),
      sources: [...entity.sources, ...sources].slice(-25),
      domain: entity.domain ?? domain,
      website: entity.website ?? (domain ? `https://${domain}` : null),
      mailing_address: entity.mailing_address ?? rdapAddress,
      aliases: Array.from(new Set([...entity.aliases, ...[name, registrantOrg, ...facts.brand_mentions].filter((x): x is string => !!x).map(slug)])),
    };
    const { data } = await supa.from("entities").update(merged).eq("id", entity.id).select("*").single();
    if (data) entity = data as Entity;
  }
  await supa.from("senders").update({ entity_id: entity.id }).eq("id", sender.id);
  return entity;
}
