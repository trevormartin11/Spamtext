import { env } from "./env";
import { ensureBudget, recordSpend } from "./spend";
import type { MailingAddress } from "./types";

export interface LobLetter { id: string; expected_delivery_date?: string; tracking_number?: string; url?: string }

/** Send a PDF as USPS Certified Mail through Lob. */
export async function lobSendCertified(opts: {
  toName: string; to: MailingAddress; pdf: Uint8Array; description: string;
}): Promise<LobLetter> {
  if (!env.lobKey) throw new Error("LOB_API_KEY not configured");
  const cents = env.lobCertifiedCents;
  await ensureBudget(cents);
  const form = new FormData();
  form.set("description", opts.description);
  form.set("color", "false");
  form.set("extra_service", "certified");
  form.set("double_sided", "true");
  form.set("address_placement", "insert_blank_page");
  form.set("to[name]", opts.toName.slice(0, 40));
  form.set("to[address_line1]", opts.to.line1.slice(0, 64));
  if (opts.to.line2) form.set("to[address_line2]", opts.to.line2.slice(0, 64));
  form.set("to[address_city]", opts.to.city);
  form.set("to[address_state]", opts.to.state);
  form.set("to[address_zip]", opts.to.zip);
  form.set("to[address_country]", opts.to.country ?? "US");
  form.set("from[name]", env.user.fullName.slice(0, 40));
  form.set("from[address_line1]", env.user.line1);
  if (env.user.line2) form.set("from[address_line2]", env.user.line2);
  form.set("from[address_city]", env.user.city);
  form.set("from[address_state]", env.user.state);
  form.set("from[address_zip]", env.user.zip);
  form.set("from[address_country]", "US");
  form.set("file", new Blob([Buffer.from(opts.pdf)], { type: "application/pdf" }), "demand.pdf");
  const auth = Buffer.from(`${env.lobKey}:`).toString("base64");
  const r = await fetch("https://api.lob.com/v1/letters", { method: "POST", headers: { Authorization: `Basic ${auth}` }, body: form });
  const j = (await r.json()) as LobLetter & { error?: { message: string } };
  if (!r.ok) throw new Error(`Lob error ${r.status}: ${j.error?.message ?? JSON.stringify(j)}`);
  await recordSpend("lob", cents, `Certified letter ${j.id} to ${opts.toName}`, j.id);
  return j;
}

export async function lobGetLetter(id: string): Promise<Record<string, unknown> | null> {
  if (!env.lobKey) return null;
  const auth = Buffer.from(`${env.lobKey}:`).toString("base64");
  const r = await fetch(`https://api.lob.com/v1/letters/${id}`, { headers: { Authorization: `Basic ${auth}` } });
  if (!r.ok) return null;
  return (await r.json()) as Record<string, unknown>;
}

/** Optional email copy of the demand letter via Resend. */
export async function emailLetter(to: string, subject: string, text: string, pdf: Uint8Array): Promise<boolean> {
  if (!env.resendKey || !env.resendFrom) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.resendFrom, to: [to], subject, text,
      attachments: [{ filename: "demand-letter.pdf", content: Buffer.from(pdf).toString("base64") }],
    }),
  });
  return r.ok;
}
