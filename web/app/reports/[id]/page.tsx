import Link from "next/link";
import { notFound } from "next/navigation";
import { db, signedUrl } from "@/lib/supabase";
import { prettyPhone } from "@/lib/phone";
import { fmtDateTime } from "@/lib/pdf";
import { agencyUrl } from "@/lib/pipeline";
import { Pill } from "../../ui";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supa = db();
  const { data: r } = await supa.from("reports").select("*, senders(*, entities(*))").eq("id", id).maybeSingle();
  if (!r) notFound();
  const [{ data: jobs }, { data: events }, { data: link }] = await Promise.all([
    supa.from("complaint_jobs").select("*").eq("report_id", id).order("agency"),
    supa.from("events").select("*").eq("report_id", id).order("created_at", { ascending: false }).limit(50),
    supa.from("claim_reports").select("claim_id").eq("report_id", id).maybeSingle(),
  ]);
  const entity = r.senders?.entities;
  const audio = r.audio_path ? await signedUrl(r.audio_path) : null;
  return (
    <>
      <h1>{r.kind} from {prettyPhone(r.sender_phone)} <Pill status={r.status} /></h1>
      <div className="cards">
        <div className="card"><div className="l">received</div>{fmtDateTime(r.received_at)}</div>
        <div className="card"><div className="l">company</div>{entity ? <Link href={`/entities/${entity.id}`}>{entity.name}</Link> : <span className="muted">unidentified</span>}</div>
        <div className="card"><div className="l">carrier / line</div>{r.senders?.carrier ?? "—"} / {r.senders?.line_type ?? "—"}{r.senders?.caller_name ? ` · ${r.senders.caller_name}` : ""}</div>
        <div className="card"><div className="l">category</div>{r.category ?? "—"}{r.is_marketing === false ? " (not marketing)" : ""}</div>
        <div className="card"><div className="l">7726 forwarded</div>{r.forwarded_7726 ? "yes" : "no"}</div>
        <div className="card"><div className="l">claim</div>{link ? <Link href={`/claims/${link.claim_id}`} className="mono">{String(link.claim_id).slice(0, 8)}</Link> : "—"}</div>
      </div>
      <h2>Message</h2>
      <pre>{r.body ?? "(no text)"}</pre>
      {audio && <audio controls src={audio} />}
      {r.extracted && <><h2>Extracted facts</h2><pre className="mono">{JSON.stringify(r.extracted, null, 2)}</pre></>}
      <h2>Government complaints</h2>
      <div className="wrap"><table><thead><tr><th>Agency</th><th>Status</th><th>Attempts</th><th>Confirmation</th><th>Error</th></tr></thead><tbody>
        {(jobs ?? []).map((j) => <tr key={j.id}><td><a href={agencyUrl(j.agency)} target="_blank">{j.agency.toUpperCase()}</a></td><td><Pill status={j.status} /></td><td>{j.attempts}</td><td className="mono">{j.confirmation ?? ""}</td><td className="muted">{j.error ?? ""}</td></tr>)}
      </tbody></table></div>
      <h2>Timeline</h2>
      <ul className="timeline">{(events ?? []).map((e) => <li key={e.id}><span className="muted">{fmtDateTime(e.created_at)}</span> — {e.message}</li>)}</ul>
    </>
  );
}
