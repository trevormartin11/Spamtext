export function Pill({ status }: { status: string }) {
  const cls = ["submitted", "identified", "settled", "demand_sent", "awaiting_response"].includes(status) ? "ok"
    : ["error", "failed", "manual"].includes(status) ? "bad"
    : ["needs_identification", "not_yet_viable", "demand_hold", "small_claims_ready", "pending"].includes(status) ? "warn" : "";
  return <span className={`pill ${cls}`}>{status.replace(/_/g, " ")}</span>;
}
