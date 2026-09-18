import React, { useMemo, useState } from "react";
import { invokeAdminFunction } from "@/lib/adminApi";
import { reportCsv } from "../../../base44/shared/seamlessPaymentReport.js";

const usd = n => n == null ? "Unknown" : new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n);
const human = s => String(s || "").replaceAll("_"," ");
const button = "rounded-lg border border-[#C9A84C]/30 px-3 py-2 text-xs text-[#C9A84C] disabled:opacity-40";
const date = s => s ? new Date(s).toLocaleString() : "Unknown";

export default function SeamlessPaymentReport() {
  const [report,setReport] = useState(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [search,setSearch] = useState("");
  const [category,setCategory] = useState("all");
  const [flagged,setFlagged] = useState(false);
  const [page,setPage] = useState(1);
  const [open,setOpen] = useState("");
  const [notice,setNotice] = useState("");
  const load = async () => {
    setBusy(true); setError(""); setNotice("");
    try { const r = await invokeAdminFunction("getSeamlessPaymentReport",{action:"list"}); setReport(r.data); setPage(1); }
    catch(e) { setReport(null); setError(e?.response?.data?.error || "Unable to load payment report."); }
    finally { setBusy(false); }
  };
  const filtered = useMemo(() => (report?.rows || []).filter(r =>
    (category === "all" || r.category === category) && (!flagged || r.flags?.length) &&
    (!search.trim() || Object.values(r).join(" ").toLowerCase().includes(search.trim().toLowerCase()))
  ), [report,category,flagged,search]);
  const pageCount = Math.max(1,Math.ceil(filtered.length/25));
  const shown = filtered.slice((Math.min(page,pageCount)-1)*25,Math.min(page,pageCount)*25);
  const refreshProvider = async row => {
    setBusy(true); setError(""); setNotice("");
    try {
      await invokeAdminFunction("getSeamlessPaymentReport",{action:"refresh_provider",provider_reference_id:row.provider_reference_id});
      const r = await invokeAdminFunction("getSeamlessPaymentReport",{action:"list"});
      setReport(r.data); setNotice("Provider evidence saved. No transfer was submitted and no wallet or ledger amounts were changed.");
    } catch(e) { setError(e?.response?.data?.error || "Provider evidence could not be refreshed. Previous observations remain dated as shown."); }
    finally { setBusy(false); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([reportCsv(filtered)],{type:"text/csv;charset=utf-8"}));
    const a = document.createElement("a"); a.href=url; a.download="chessbet-payment-reconciliation-"+new Date().toISOString().slice(0,10)+".csv";
    a.click(); URL.revokeObjectURL(url);
  };
  return <section className="mb-6 rounded-xl border border-[#C9A84C]/25 bg-[#C9A84C]/[0.035] p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-bold text-white">Seamless payment reconciliation</h2>
        <p className="mt-1 text-xs text-white/50">Trace player payments, merchant transfers and provider charges by ChessBet ID, Seamless ID, dashboard number or account.</p></div>
      <div className="flex gap-2"><button className={button} disabled={busy} onClick={load}>{busy ? "Loading…" : report ? "Reload report" : "Load payment report"}</button>
        {report && <button className={button} disabled={busy} onClick={download}>Export payment CSV</button>}</div>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    {notice && <p role="status" className="mt-3 text-xs text-emerald-300">{notice}</p>}
    {report && <>
      <p className="mt-3 text-xs leading-5 text-white/50">{report.scope}</p>
      <p className="mt-1 text-xs leading-5 text-white/40">{report.note} Provider refresh uses a read-only lookup and saves a dated observation.</p>
      <div className="my-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{[
        ["Payment records",report.rows.length],
        ["Review indicators",report.rows.filter(r=>r.flags?.length).length],
        ["Merchant transfers",report.rows.filter(r=>r.category==="merchant_transfer").length],
        ["Provider charges",report.rows.filter(r=>r.category==="provider_charge").length],
      ].map(([label,value])=><div key={label} className="rounded-lg bg-white/5 p-3"><p className="text-xs text-white/40">{label}</p><p className="text-xl font-bold text-white">{value}</p></div>)}</div>
      <div className="mb-3 flex flex-wrap gap-3">
        <input aria-label="Search payment reconciliation" placeholder="Search transaction, label, dashboard number, account…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} className="min-w-[240px] flex-1 rounded-lg border border-white/15 bg-black/30 p-2 text-xs text-white"/>
        <select aria-label="Payment category" value={category} onChange={e=>{setCategory(e.target.value);setPage(1);}} className="rounded-lg bg-[#111] p-2 text-xs text-white"><option value="all">All payment categories</option>{["player_deposit","player_withdrawal","merchant_transfer","provider_charge","unmatched_reference"].map(c=><option key={c} value={c}>{human(c)}</option>)}</select>
        <label className="flex items-center gap-2 text-xs text-white/60"><input type="checkbox" checked={flagged} onChange={e=>{setFlagged(e.target.checked);setPage(1);}}/>Needs review</label>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-xs">
        <thead className="text-white/40"><tr>{["Payment","ChessBet ID / label","Seamless ID / number","Amounts","Status / evidence","Review"].map(x=><th key={x} className="p-2">{x}</th>)}</tr></thead>
        <tbody>{shown.map(r=><React.Fragment key={r.key}>
          <tr className="border-t border-white/10 align-top text-white/70">
            <td className="p-2"><p className="font-bold">{human(r.category)}</p><p className="mt-1 max-w-[180px] break-words text-white/40">{r.description}</p><p className="mt-1 text-white/30">{date(r.created_at)}</p></td>
            <td className="max-w-[260px] break-all p-2 font-mono text-[10px]"><p>{r.wallet_transaction_id || "Merchant account"}</p><p className="mt-1 text-white/40">{r.label || "No player label"}</p></td>
            <td className="max-w-[250px] break-all p-2"><p className="font-mono text-[10px]">{r.provider_reference_ids || "No provider ID recorded"}</p><p className="mt-1">Dashboard #: {r.dashboard_number || "Not observed"}</p>
              {r.provider_reference_id && <button className={button+" mt-2"} disabled={busy || r.flags?.includes("provider_id_reused")} onClick={()=>refreshProvider(r)}>Refresh provider evidence</button>}</td>
            <td className="whitespace-nowrap p-2"><p>Principal: {usd(r.principal)}</p><p>Bank request: {usd(r.requested_bank_amount)}</p><p>Provider amount: {usd(r.provider_amount)}</p><p>Player fee: {usd(r.player_fee)}</p><p>Net received: {usd(r.net_received)}</p></td>
            <td className="p-2"><p>ChessBet: {r.category.startsWith("player_") ? human(r.status) : "Not a player payment"}</p><p>Provider: {human(r.provider_status) || "Unknown"}</p><p className="mt-1 text-white/35">Checked: {date(r.provider_checked_at)}</p></td>
            <td className="max-w-[230px] p-2"><ul className="space-y-1 text-amber-200/80">{(r.flags||[]).map(f=><li key={f}>{human(f)}</li>)}</ul>
              {!r.flags?.length && <p className="text-white/40">No tracking flags</p>}
              <button className={button+" mt-2"} onClick={()=>setOpen(open===r.key ? "" : r.key)}>{open===r.key ? "Hide tracking details" : "Tracking details"}</button></td>
          </tr>
          {open===r.key && <tr><td colSpan={6} className="bg-black/20 p-4"><dl className="grid gap-3 sm:grid-cols-3">{[
            ["Player ID",r.user_id],["Seamless customer ID",r.provider_customer_id],["Funding source",r.funding_source_id],
            ["Bank",r.bank_name ? r.bank_name+" "+(r.bank_last_four ? "••••"+r.bank_last_four : "") : ""],
            ["ACH authorization",r.ach_authorization_id],["Ledger group",r.ledger_group_id],["Idempotency key",r.idempotency_key],
            ["Provider description",r.provider_description],["Provider label",r.provider_label],
            ["Historical reference states",r.reference_statuses],["Settlement evidence",r.evidence_references],
            ["Processing fee (evidenced)",usd(r.processing_fee)],["Provider settlement date",r.settled_at || "Not recorded"],
            ["Internal posting date",date(r.ledger_processed_at)],["Historical audit amount (unverified)",r.audit_reported_amount],
            ["Audit event IDs",r.audit_event_ids],
          ].map(([k,v])=><div key={k}><dt className="text-white/35">{k}</dt><dd className="mt-1 break-all font-mono text-[11px] text-white/70">{v ?? "Not recorded"}</dd></div>)}</dl></td></tr>}
        </React.Fragment>)}
        {!shown.length && <tr><td colSpan={6} className="p-6 text-center text-white/40">No payment records match these filters.</td></tr>}</tbody>
      </table></div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-white/40"><p>{filtered.length} matching records · Refreshed {date(report.generated_at)}</p><div className="flex items-center gap-3"><button className={button} disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Previous payments</button><span>Page {Math.min(page,pageCount)} of {pageCount}</span><button className={button} disabled={page>=pageCount} onClick={()=>setPage(p=>p+1)}>Next payments</button></div></div>
    </>}
  </section>;
}
