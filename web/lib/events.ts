import { db } from "./supabase";

export async function logEvent(
  message: string,
  opts: { reportId?: string; claimId?: string; level?: "info" | "warn" | "error"; data?: unknown } = {},
): Promise<void> {
  const { error } = await db().from("events").insert({
    report_id: opts.reportId ?? null,
    claim_id: opts.claimId ?? null,
    level: opts.level ?? "info",
    message,
    data: opts.data ?? null,
  });
  if (error) console.error("logEvent failed", error.message);
}
