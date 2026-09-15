import { checkCron } from "@/lib/auth";
import { runDaily } from "@/lib/pipeline";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!checkCron(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();
  try {
    const stats = await runDaily();
    await logEvent("Daily run complete", { data: { ...stats, ms: Date.now() - started } });
    return Response.json({ ok: true, stats });
  } catch (e) {
    await logEvent("Daily run failed: " + (e as Error).message, { level: "error" });
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
