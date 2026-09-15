import { createHash } from "node:crypto";
import { z } from "zod";
import { db, uploadDocument } from "@/lib/supabase";
import { checkAppKey } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { processReport } from "@/lib/pipeline";
import { logEvent } from "@/lib/events";
import { after } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ReportIn = z.object({
  kind: z.enum(["sms", "call", "voicemail"]),
  sender: z.string().min(2),
  body: z.string().optional().nullable(),
  received_at: z.string().datetime({ offset: true }).or(z.number()),
  duration_seconds: z.number().int().optional().nullable(),
  prerecorded: z.boolean().optional().nullable(),
  forwarded_7726: z.boolean().optional(),
  device_id: z.string().optional(),
  audio_base64: z.string().optional(),
  audio_mime: z.string().optional(),
});

/** POST /api/reports — called by the Android app. Accepts one report or {reports:[...]} for backfill. */
export async function POST(req: Request) {
  if (!checkAppKey(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const json = await req.json().catch(() => null);
  const list = Array.isArray(json?.reports) ? json.reports : [json];
  const parsed = z.array(ReportIn).max(200).safeParse(list);
  if (!parsed.success) return Response.json({ error: "bad request", issues: parsed.error.issues }, { status: 400 });

  const supa = db();
  const results: { id: string; created: boolean }[] = [];
  const toProcess: string[] = [];
  for (const r of parsed.data) {
    const phone = normalizePhone(r.sender);
    const receivedAt = typeof r.received_at === "number" ? new Date(r.received_at) : new Date(r.received_at);
    const dedupe = createHash("sha256").update(`${r.kind}|${phone}|${receivedAt.toISOString()}|${r.body ?? ""}`).digest("hex");
    const { data: existing } = await supa.from("reports").select("id").eq("dedupe_key", dedupe).maybeSingle();
    if (existing) { results.push({ id: existing.id as string, created: false }); continue; }
    const { data, error } = await supa.from("reports").insert({
      kind: r.kind, sender_phone: phone, body: r.body ?? null, received_at: receivedAt.toISOString(),
      duration_seconds: r.duration_seconds ?? null, prerecorded: r.prerecorded ?? null,
      forwarded_7726: r.forwarded_7726 ?? false, forwarded_7726_at: r.forwarded_7726 ? new Date().toISOString() : null,
      device_id: r.device_id ?? null, dedupe_key: dedupe,
    }).select("id").single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const id = data.id as string;
    if (r.audio_base64) {
      const ext = (r.audio_mime ?? "audio/mp4").split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "m4a";
      const path = `voicemail/${id}.${ext}`;
      await uploadDocument(path, Buffer.from(r.audio_base64, "base64"), r.audio_mime ?? "audio/mp4");
      await supa.from("reports").update({ audio_path: path }).eq("id", id);
    }
    await logEvent(`Received ${r.kind} from ${phone}`, { reportId: id });
    results.push({ id, created: true });
    toProcess.push(id);
  }
  // Process after the response is sent so the phone gets a fast ack. Large backfills: the first few run now,
  // the rest stay in `received` and the daily cron picks them up.
  const now = toProcess.slice(0, 10);
  after(async () => { for (const id of now) await processReport(id); });
  return Response.json({ results });
}

/** GET /api/reports?limit=50 — status list for the app's "Reported" tab. */
export async function GET(req: Request) {
  if (!checkAppKey(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const limit = Math.min(200, Number(new URL(req.url).searchParams.get("limit") ?? 50));
  const supa = db();
  const { data: reports } = await supa.from("reports")
    .select("id,kind,sender_phone,body,received_at,status,is_marketing,category,forwarded_7726,created_at,senders(entity_id,entities(name))")
    .order("received_at", { ascending: false }).limit(limit);
  const ids = (reports ?? []).map((r) => r.id as string);
  const { data: jobs } = ids.length ? await supa.from("complaint_jobs").select("report_id,agency,status,confirmation").in("report_id", ids) : { data: [] };
  const { data: links } = ids.length ? await supa.from("claim_reports").select("report_id,claims(id,status,violation_count,estimated_min_cents,estimated_max_cents)").in("report_id", ids) : { data: [] };
  const jobsBy: Record<string, unknown[]> = {};
  for (const j of jobs ?? []) (jobsBy[j.report_id as string] ??= []).push({ agency: j.agency, status: j.status, confirmation: j.confirmation });
  const claimBy: Record<string, unknown> = {};
  for (const l of links ?? []) claimBy[l.report_id as string] = l.claims;
  return Response.json({
    reports: (reports ?? []).map((r) => {
      const senders = r.senders as unknown as { entities?: { name?: string } | null } | null;
      return { ...r, senders: undefined, entity_name: senders?.entities?.name ?? null, complaints: jobsBy[r.id as string] ?? [], claim: claimBy[r.id as string] ?? null };
    }),
  });
}
