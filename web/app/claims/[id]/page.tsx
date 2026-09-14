import Link from "next/link";
import { notFound } from "next/navigation";
import { db, signedUrl } from "@/lib/supabase";
import { dollars } from "@/lib/assess";
import { prettyPhone } from "@/lib/phone";
import { fmtDateTime } from "@/lib/pdf";
import { Pill } from "../../ui";

export const dynamic = "force-dynamic";

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supa = db();
  const { data: c } = await supa.from("claims").select("*, entities(*)").eq("id", id).maybeSingle();
  if (!c) notFound();
  const [{ data: links }, { data: events }] = await Promise.all([
    supa.from("claim_reports").select("reports(id,kind,sender_phone,body,received_at,prerecorded)").eq("claim_id", id),
    supa.from("events").select("*").eq("claim_id", id).order("created_at", { ascending: false }).limit(50),
  ]);
  const letter = c.demand_letter_path ? await signedUrl(c.demand_letter_path) : null;
  const packet = c.small_claims_packet_path ? await signedUrl(c.small_claims_packet_path) : null;
  const reports = (links ?? []).map((l) => l.reports as unknown as Record<string, any>).filter(Boolean).sort((a, b) => a.received_at.localeCompare(b.received_at)); // eslint-disable-line @typescript-eslint/no-explicit-any
  return (
    <>
      <h1>Claim against {c.entities ? <Link href={`/entities/${c.entity_id}`}>{c.entities.name}</Link> : prettyPhone(c.sender_phone ?? "")} <Pill status={c.status} /></h1>
      <div className="cards">
        <div className="card"><div className="n">{c.violation_count}</div><div className="l">violations (12 mo)</div></div>
        <div className="card"><div className="n">{dollars(c.estimated_min_cents)}–{dollars(c.estimated_max_cents)}</div><div className="l">statutory range</div></div>
        <div className="card"><div className="n">{c.demand_amount_cents ? dollars(c.demand_amount_cents) : "—"}</div><div className="l">demanded</div></div>
        <div className="card"><div className="l">demand sent</div>{c.demand_sent_at ? `${fmtDateTime(c.demand_sent_at)} via ${c.demand_channel}` : c.demand_hold_until ? `auto-send ${fmtDateTime(c.demand_hold_until)}` : "—"}</div>
        <div className="card"><div className="l">response deadline</div>{c.response_deadline ?? "—"}</div>
        <div className="card"><div className="l">documents</div>{letter && <a href={letter}>Demand letter</a>}{letter && packet && " · "}{packet && <a href={packet}>Small claims packet</a>}{!letter && !packet && "—"}</div>
      </div>
      <h2>Legal basis</h2>
      <ul>
        <li>47 U.S.C. § 227(c)(5) Do Not Call: <b>{c.basis?.tcpa_c5 ? "yes" : "no"}</b> (registered 31+ days: {c.basis?.dnc_eligible ? "yes" : "no"})</li>
        <li>47 U.S.C. § 227(b)(3) prerecorded voice: <b>{c.basis?.tcpa_b3 ? "yes" : "no"}</b></li>
        <li>47 C.F.R. § 64.1200(d) identification/internal DNC: <b>{c.basis?.cfr_1200d ? "yes" : "no"}</b></li>
        <li>A.R.S. § 44-1282: <b>{c.basis?.az_1282 ? "cited" : "no"}</b></li>
        {(c.basis?.reasons ?? []).map((r: string, i: number) => <li key={i} className="muted">{r}</li>)}
      </ul>
      {c.lob_tracking && <><h2>Mail tracking</h2><pre className="mono">{JSON.stringify(c.lob_tracking, null, 2)}</pre></>}
      <h2>Messages in this claim</h2>
      <div className="wrap"><table><thead><tr><th>When</th><th>Kind</th><th>From</th><th>Message</th></tr></thead><tbody>
        {reports.map((r) => <tr key={r.id}><td><Link href={`/reports/${r.id}`}>{fmtDateTime(r.received_at)}</Link></td><td>{r.kind}{r.prerecorded ? " (recorded)" : ""}</td><td className="mono">{prettyPhone(r.sender_phone)}</td><td className="muted">{(r.body ?? "").slice(0, 120)}</td></tr>)}
      </tbody></table></div>
      {c.notes && <><h2>Notes</h2><p>{c.notes}</p></>}
      <h2>Timeline</h2>
      <ul className="timeline">{(events ?? []).map((e) => <li key={e.id}><span className="muted">{fmtDateTime(e.created_at)}</span> — {e.message}</li>)}</ul>
      <p className="muted">Telegram: /send, /cancel, /sent, /responded, /filed, /settled with claim id <span className="mono">{id.slice(0, 8)}</span>.</p>
    </>
  );
}
