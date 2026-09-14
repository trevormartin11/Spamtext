import { db } from "@/lib/supabase";
import { checkAppKey } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!checkAppKey(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const supa = db();
  const { data: report } = await supa.from("reports").select("*").eq("id", id).maybeSingle();
  if (!report) return Response.json({ error: "not found" }, { status: 404 });
  const [{ data: jobs }, { data: events }] = await Promise.all([
    supa.from("complaint_jobs").select("*").eq("report_id", id),
    supa.from("events").select("*").eq("report_id", id).order("created_at", { ascending: false }).limit(50),
  ]);
  return Response.json({ report, complaints: jobs ?? [], events: events ?? [] });
}
