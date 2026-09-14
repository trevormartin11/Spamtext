import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { prettyPhone } from "@/lib/phone";
import { fmtDateTime } from "@/lib/pdf";
import { Pill } from "../../ui";

export const dynamic = "force-dynamic";

export default async function EntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supa = db();
  const { data: e } = await supa.from("entities").select("*").eq("id", id).maybeSingle();
  if (!e) notFound();
  const [{ data: senders }, { data: claims }, { data: hits }] = await Promise.all([
    supa.from("senders").select("*").eq("entity_id", id),
    supa.from("claims").select("*").eq("entity_id", id).order("created_at", { ascending: false }),
    supa.from("monitor_hits").select("*").eq("entity_id", id).order("found_at", { ascending: false }),
  ]);
  const a = e.mailing_address;
  return (
    <>
      <h1>{e.name} <span className="muted">confidence {Math.round(e.confidence * 100)}%{e.manual ? " · manual" : ""}</span></h1>
      <div className="cards">
        <div className="card"><div className="l">website</div>{e.website ? <a href={e.website} target="_blank" rel="noreferrer">{e.domain}</a> : "—"}</div>
        <div className="card"><div className="l">mailing address</div>{a ? `${a.line1}${a.line2 ? ", " + a.line2 : ""}, ${a.city} ${a.state} ${a.zip}` : <span className="muted">unknown — set with /entity in Telegram</span>}</div>
        <div className="card"><div className="l">registered agent</div>{e.registered_agent ? `${e.registered_agent.name}, ${e.registered_agent.address}` : "—"}</div>
        <div className="card"><div className="l">email</div>{e.email ?? "—"}</div>
        <div className="card"><div className="l">AZ SoS registered</div>{e.az_sos_registered == null ? "unchecked" : e.az_sos_registered ? "yes" : "no"}</div>
      </div>
      <h2>Numbers used</h2>
      <ul>{(senders ?? []).map((s) => <li key={s.id} className="mono">{prettyPhone(s.phone)} {s.carrier ? `· ${s.carrier}` : ""} {s.line_type ? `· ${s.line_type}` : ""} {s.caller_name ? `· ${s.caller_name}` : ""}</li>)}</ul>
      <h2>Evidence</h2>
      <ul>{(e.sources ?? []).map((s: { type: string; url?: string; note?: string }, i: number) => <li key={i}>{s.type}: {s.note}{s.url && <> · <a href={s.url} target="_blank" rel="noreferrer">link</a></>}</li>)}</ul>
      <h2>Claims</h2>
      <ul>{(claims ?? []).map((c) => <li key={c.id}><Link href={`/claims/${c.id}`} className="mono">{c.id.slice(0, 8)}</Link> <Pill status={c.status} /> {c.violation_count} violations</li>)}</ul>
      <h2>Enforcement / settlement mentions</h2>
      {(hits ?? []).length === 0 ? <p className="muted">None found yet. Checked daily against FTC and FCC news feeds and class-action trackers.</p>
        : <ul>{(hits ?? []).map((h) => <li key={h.id}><a href={h.url} target="_blank" rel="noreferrer">{h.title}</a> <span className="muted">{h.source} · {fmtDateTime(h.found_at)}</span></li>)}</ul>}
      <p className="muted">Lookup tips: Arizona eCorp <a href="https://ecorp.azcc.gov/" target="_blank" rel="noreferrer">ecorp.azcc.gov</a>, Arizona telephone-solicitor registry via the Secretary of State, OpenCorporates, the company's privacy policy page for a legal address.</p>
    </>
  );
}
