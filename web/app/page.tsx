import Link from "next/link";
import { db } from "@/lib/supabase";
import { dollars } from "@/lib/assess";
import { monthSpendCents, monthlyCapCents } from "@/lib/spend";
import { prettyPhone } from "@/lib/phone";
import { fmtDateTime } from "@/lib/pdf";
import { Pill } from "./ui";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = "overview" } = await searchParams;
  const supa = db();
  const [{ count: reportCount }, { count: submitted }, { data: claims }, spent, cap, { data: reports }, { data: spend }] = await Promise.all([
    supa.from("reports").select("id", { count: "exact", head: true }),
    supa.from("complaint_jobs").select("id", { count: "exact", head: true }).eq("status", "submitted"),
    supa.from("claims").select("*, entities(name)").order("updated_at", { ascending: false }).limit(100),
    monthSpendCents(), monthlyCapCents(),
    supa.from("reports").select("id,kind,sender_phone,body,received_at,status,category,is_marketing,senders(entities(name))").order("received_at", { ascending: false }).limit(100),
    supa.from("spend").select("*").order("created_at", { ascending: false }).limit(100),
  ]);
  const open = (claims ?? []).filter((c) => !["settled", "closed"].includes(c.status));
  const min = open.reduce((a, c) => a + c.estimated_min_cents, 0);
  const max = open.reduce((a, c) => a + c.estimated_max_cents, 0);
  const settled = (claims ?? []).filter((c) => c.status === "settled").length;

  return (
    <>
      <h1>{tab === "overview" ? "Overview" : tab[0].toUpperCase() + tab.slice(1)}</h1>
      {tab === "overview" && (
        <>
          <div className="cards">
            <div className="card"><div className="n">{reportCount ?? 0}</div><div className="l">reports</div></div>
            <div className="card"><div className="n">{submitted ?? 0}</div><div className="l">complaints filed</div></div>
            <div className="card"><div className="n">{open.length}</div><div className="l">open claims</div></div>
            <div className="card"><div className="n">{dollars(min)}–{dollars(max)}</div><div className="l">potential recovery</div></div>
            <div className="card"><div className="n">{settled}</div><div className="l">settled</div></div>
            <div className="card"><div className="n">{dollars(spent)}</div><div className="l">spent of {dollars(cap)} this month</div></div>
          </div>
          <h2>Open claims</h2>
          <ClaimsTable claims={open} />
          <h2>Recent reports</h2>
          <ReportsTable reports={(reports ?? []).slice(0, 15)} />
        </>
      )}
      {tab === "reports" && <ReportsTable reports={reports ?? []} />}
      {tab === "claims" && <ClaimsTable claims={claims ?? []} />}
      {tab === "spend" && (
        <div className="wrap"><table><thead><tr><th>When</th><th>Category</th><th>Amount</th><th>Description</th></tr></thead><tbody>
          {(spend ?? []).map((s) => <tr key={s.id}><td>{fmtDateTime(s.created_at)}</td><td>{s.category}</td><td>{dollars(s.amount_cents)}</td><td>{s.description}</td></tr>)}
          {(spend ?? []).length === 0 && <tr><td colSpan={4} className="muted">No spend yet.</td></tr>}
        </tbody></table></div>
      )}
    </>
  );
}

function ClaimsTable({ claims }: { claims: Record<string, any>[] }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  return (
    <div className="wrap"><table><thead><tr><th>Claim</th><th>Against</th><th>Status</th><th>Violations</th><th>Potential</th><th>Deadline</th></tr></thead><tbody>
      {claims.map((c) => (
        <tr key={c.id}>
          <td><Link href={`/claims/${c.id}`} className="mono">{c.id.slice(0, 8)}</Link></td>
          <td>{c.entities?.name ? <Link href={`/entities/${c.entity_id}`}>{c.entities.name}</Link> : <span className="muted">{prettyPhone(c.sender_phone ?? "")} (unidentified)</span>}</td>
          <td><Pill status={c.status} /></td>
          <td>{c.violation_count}</td>
          <td>{dollars(c.estimated_min_cents)}–{dollars(c.estimated_max_cents)}</td>
          <td>{c.response_deadline ?? ""}</td>
        </tr>
      ))}
      {claims.length === 0 && <tr><td colSpan={6} className="muted">No claims yet.</td></tr>}
    </tbody></table></div>
  );
}

function ReportsTable({ reports }: { reports: Record<string, any>[] }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  return (
    <div className="wrap"><table><thead><tr><th>When</th><th>Kind</th><th>From</th><th>Company</th><th>Message</th><th>Status</th></tr></thead><tbody>
      {reports.map((r) => (
        <tr key={r.id}>
          <td><Link href={`/reports/${r.id}`}>{fmtDateTime(r.received_at)}</Link></td>
          <td>{r.kind}</td>
          <td className="mono">{prettyPhone(r.sender_phone)}</td>
          <td>{r.senders?.entities?.name ?? <span className="muted">—</span>}</td>
          <td className="muted">{(r.body ?? "").slice(0, 90)}</td>
          <td><Pill status={r.status} />{r.is_marketing === false && <span className="muted"> not marketing</span>}</td>
        </tr>
      ))}
      {reports.length === 0 && <tr><td colSpan={6} className="muted">Nothing reported yet. Share a text to the Spamtext app on your phone.</td></tr>}
    </tbody></table></div>
  );
}
