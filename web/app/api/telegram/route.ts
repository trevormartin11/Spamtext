import { checkTelegram } from "@/lib/auth";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase";
import { tgSend, tgAnswerCallback, esc } from "@/lib/telegram";
import { setSetting } from "@/lib/settings";
import { monthSpendCents, monthlyCapCents } from "@/lib/spend";
import { dollars } from "@/lib/assess";
import { sendDemand, markDemandSent, processReport, advanceClaim } from "@/lib/pipeline";
import { logEvent } from "@/lib/events";
import { prettyPhone } from "@/lib/phone";
import type { Claim } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Update {
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
}

/** Resolve an 8-char prefix (or full uuid) to a row id in `table`. */
async function resolveId(table: "claims" | "reports", prefix: string): Promise<string | null> {
  const p = prefix.trim().toLowerCase();
  if (!/^[0-9a-f-]{4,36}$/.test(p)) return null;
  const { data } = await db().from(table).select("id").like("id", `${p}%`).limit(2);
  return data && data.length === 1 ? (data[0].id as string) : null;
}

const HELP = [
  "<b>Commands</b>",
  "/status — open reports and claims",
  "/spend — this month's spend vs cap",
  "/report &lt;id&gt; — details for a report",
  "/send &lt;claim&gt; — send a held demand letter now",
  "/cancel &lt;claim&gt; — stop a held demand letter (claim closed)",
  "/sent &lt;claim&gt; — you mailed the letter yourself",
  "/responded &lt;claim&gt; — the company replied",
  "/filed &lt;claim&gt; — you filed in small claims",
  "/settled &lt;claim&gt; &lt;amount&gt; — record a settlement",
  "/dnc YYYY-MM-DD — your Do Not Call registration date",
  "/entity &lt;report&gt; | Company | address — identify a sender by hand",
  "/cap 25 — change the monthly spend cap (dollars)",
].join("\n");

async function handleCommand(text: string): Promise<string> {
  const [cmd, ...rest] = text.trim().split(/\s+/);
  const arg = rest.join(" ");
  const supa = db();
  switch (cmd.toLowerCase().replace(/@.*$/, "")) {
    case "/start":
    case "/help":
      return HELP;
    case "/status": {
      const { data: reports } = await supa.from("reports").select("id,kind,sender_phone,status,received_at").order("received_at", { ascending: false }).limit(8);
      const { data: claims } = await supa.from("claims").select("*, entities(name)").not("status", "in", "(settled,closed)").order("updated_at", { ascending: false }).limit(10);
      const r = (reports ?? []).map((x) => `• ${x.id.slice(0, 8)} ${x.kind} ${esc(prettyPhone(x.sender_phone))} — ${x.status}`).join("\n") || "none";
      const c = (claims ?? []).map((x) => `• ${x.id.slice(0, 8)} <b>${esc((x.entities as { name?: string } | null)?.name ?? prettyPhone(x.sender_phone ?? "?"))}</b> — ${x.status}, ${x.violation_count} viol., ${dollars(x.estimated_min_cents)}–${dollars(x.estimated_max_cents)}`).join("\n") || "none";
      return `<b>Recent reports</b>\n${r}\n\n<b>Open claims</b>\n${c}\n\n${env.publicBaseUrl}`;
    }
    case "/spend": {
      const [s, cap] = await Promise.all([monthSpendCents(), monthlyCapCents()]);
      return `Spent ${dollars(s)} of ${dollars(cap)} this month.`;
    }
    case "/cap": {
      const d = Number(arg);
      if (!Number.isFinite(d) || d < 0) return "Usage: /cap 25";
      await setSetting("monthly_cap_cents", Math.round(d * 100));
      return `Monthly cap set to ${dollars(Math.round(d * 100))}.`;
    }
    case "/dnc": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(arg)) return "Usage: /dnc YYYY-MM-DD (the date your number was registered at donotcall.gov; verify at https://www.donotcall.gov/verify.html)";
      await setSetting("dnc_registered_at", arg);
      const { data: claims } = await supa.from("claims").select("id").in("status", ["assessing", "not_yet_viable"]);
      const { data: reports } = await supa.from("reports").select("id").in("status", ["identified", "needs_identification"]).limit(100);
      for (const r of reports ?? []) await processReport(r.id as string, { notify: false });
      for (const c of claims ?? []) await advanceClaim(c.id as string);
      return `Do Not Call registration date set to ${arg}. Re-assessed ${claims?.length ?? 0} claim(s).`;
    }
    case "/report": {
      const id = await resolveId("reports", arg);
      if (!id) return "Report not found.";
      const { data: r } = await supa.from("reports").select("*").eq("id", id).single();
      const { data: jobs } = await supa.from("complaint_jobs").select("agency,status,confirmation").eq("report_id", id);
      return `<b>${r.kind}</b> from ${esc(prettyPhone(r.sender_phone))} at ${esc(r.received_at)}\nStatus: ${r.status}${r.category ? ", " + r.category : ""}${r.is_marketing === false ? " (not marketing)" : ""}\n${esc(r.body ?? "")}\n\nComplaints: ${(jobs ?? []).map((j) => `${j.agency}=${j.status}${j.confirmation ? " #" + j.confirmation : ""}`).join(", ") || "none"}\n${env.publicBaseUrl}/reports/${id}`;
    }
    case "/send": {
      const id = await resolveId("claims", arg);
      if (!id) return "Claim not found.";
      await sendDemand(id);
      return "Sending.";
    }
    case "/cancel": {
      const id = await resolveId("claims", arg);
      if (!id) return "Claim not found.";
      const { data } = await supa.from("claims").select("status").eq("id", id).single();
      if ((data as Claim).status !== "demand_hold") return `Claim is ${(data as Claim).status}; only a held demand letter can be cancelled.`;
      await supa.from("claims").update({ status: "closed", notes: "Cancelled by user before sending" }).eq("id", id);
      await logEvent("Demand cancelled by user", { claimId: id });
      return "Cancelled and closed. New messages from this sender will open a fresh claim.";
    }
    case "/sent": {
      const id = await resolveId("claims", arg);
      if (!id) return "Claim not found.";
      await markDemandSent(id, "manual", null);
      return "Marked as sent; 30-day deadline started.";
    }
    case "/responded": {
      const id = await resolveId("claims", arg);
      if (!id) return "Claim not found.";
      await supa.from("claims").update({ status: "responded" }).eq("id", id);
      await logEvent("Company responded (user)", { claimId: id });
      return "Marked responded. When you agree on a number, use /settled <claim> <amount>; if they refuse, /filed after you file.";
    }
    case "/filed": {
      const id = await resolveId("claims", arg);
      if (!id) return "Claim not found.";
      await supa.from("claims").update({ status: "filed" }).eq("id", id);
      return "Marked filed. Good luck at the hearing.";
    }
    case "/settled": {
      const [cid, amt] = arg.split(/\s+/);
      const id = await resolveId("claims", cid ?? "");
      if (!id) return "Claim not found. Usage: /settled <claim> <amount>";
      const cents = Math.round(Number(String(amt ?? "").replace(/[$,]/g, "")) * 100);
      await supa.from("claims").update({ status: "settled", notes: `Settled for ${Number.isFinite(cents) ? dollars(cents) : amt}` }).eq("id", id);
      await logEvent(`Settled for ${amt}`, { claimId: id });
      return `🎉 Recorded settlement of ${Number.isFinite(cents) ? dollars(cents) : amt}.`;
    }
    case "/entity": {
      const parts = arg.split("|").map((s) => s.trim());
      const [rid, name, address] = parts;
      const id = await resolveId("reports", rid ?? "");
      if (!id || !name) return "Usage: /entity <report id> | Company Name | 123 Main St, City, ST 00000";
      const { data: report } = await supa.from("reports").select("sender_phone").eq("id", id).single();
      let mailing_address = null;
      if (address) {
        const m = address.match(/^(.*?),\s*([^,]+),\s*([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)$/);
        mailing_address = m ? { line1: m[1], city: m[2], state: m[3].toUpperCase(), zip: m[4], source: "user" } : { line1: address, city: "", state: "", zip: "", source: "user_unparsed" };
      }
      const { data: existing } = await supa.from("entities").select("id").ilike("name", name).maybeSingle();
      let entityId: string;
      if (existing) {
        entityId = existing.id as string;
        await supa.from("entities").update({ manual: true, confidence: 1, ...(mailing_address ? { mailing_address } : {}) }).eq("id", entityId);
      } else {
        const { data: e } = await supa.from("entities").insert({ name, manual: true, confidence: 1, mailing_address, sources: [{ type: "user" }] }).select("id").single();
        entityId = e!.id as string;
      }
      await supa.from("senders").update({ entity_id: entityId }).eq("phone", report!.sender_phone);
      await supa.from("claims").update({ status: "closed", notes: "Superseded: sender identified" }).is("entity_id", null).eq("sender_phone", report!.sender_phone).in("status", ["assessing", "not_yet_viable"]);
      const { data: rs } = await supa.from("reports").select("id").eq("sender_phone", report!.sender_phone);
      for (const r of rs ?? []) await processReport(r.id as string, { notify: false });
      return `Linked ${esc(prettyPhone(report!.sender_phone))} to <b>${esc(name)}</b>${mailing_address && mailing_address.city ? " with a mailing address" : address ? " (address not parsed as 'street, city, ST zip'; fix it in the dashboard)" : ""}. Re-assessed.`;
    }
    default:
      return "Unknown command. " + HELP;
  }
}

export async function POST(req: Request) {
  if (!checkTelegram(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const update = (await req.json().catch(() => ({}))) as Update;
  const chatId = String(update.message?.chat.id ?? update.callback_query?.message?.chat.id ?? "");
  if (!chatId || chatId !== env.telegramChatId) return Response.json({ ok: true }); // ignore strangers

  if (update.callback_query) {
    const [action, id] = (update.callback_query.data ?? "").split(":");
    let reply = "ok";
    try {
      if (action === "send") { await sendDemand(id); reply = "Sending"; }
      else if (action === "cancel") { reply = await handleCommand(`/cancel ${id}`); }
    } catch (e) { reply = (e as Error).message; }
    await tgAnswerCallback(update.callback_query.id, reply.replace(/<[^>]+>/g, "").slice(0, 200));
    if (action === "cancel") await tgSend(reply);
    return Response.json({ ok: true });
  }
  const text = update.message?.text ?? "";
  if (!text.startsWith("/")) return Response.json({ ok: true });
  let reply: string;
  try { reply = await handleCommand(text); } catch (e) { reply = "Error: " + esc((e as Error).message); }
  await tgSend(reply, { chatId });
  return Response.json({ ok: true });
}
