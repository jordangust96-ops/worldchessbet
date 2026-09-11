import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { invokeAdminFunction } from "@/lib/adminApi";

const PAGE_SIZE = 50;

function formatUsd(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function shortId(value, start = 8, end = 6) {
  if (!value) return "—";
  const text = String(value);
  if (text.length <= start + end + 3) return text;
  return `${text.slice(0, start)}…${text.slice(-end)}`;
}

function humanize(value) {
  if (!value) return "—";
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function statusClass(value) {
  const status = String(value || "").toLowerCase();
  if (["completed", "settled", "released", "matched", "committed", "processed"].includes(status)) {
    return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
  }
  if (["failed", "reversed", "mismatch", "review_required", "manual_review", "uncertain"].includes(status)) {
    return "border-red-400/20 bg-red-400/10 text-red-300";
  }
  if (["pending", "processing", "reserved", "submitting", "submitted", "posting", "projecting", "active", "held"].includes(status)) {
    return "border-amber-300/20 bg-amber-300/10 text-amber-200";
  }
  return "border-white/10 bg-white/[0.04] text-white/55";
}

function StatusPill({ value }) {
  if (!value || value === "—") return <span className="text-white/25">—</span>;
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusClass(value)}`}>
      {humanize(value)}
    </span>
  );
}

function CopyValue({ value, label }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-white/25">—</span>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard can be blocked by the browser; the full value remains visible.
    }
  };
  return (
    <button onClick={copy} className="group inline-flex max-w-full items-center gap-1.5 text-left" title={`Copy ${label || "value"}`}>
      <span className="break-all font-mono text-[11px] text-white/65 group-hover:text-white">{value}</span>
      <Copy size={11} className="shrink-0 text-white/20 group-hover:text-[#C9A84C]" />
      {copied && <span className="text-[9px] text-[#C9A84C]">Copied</span>}
    </button>
  );
}

function DetailField({ label, children }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-white/30">{label}</p>
      <div className="mt-1 text-xs text-white/70">{children ?? "—"}</div>
    </div>
  );
}

function Section({ title, children, right }) {
  return (
    <section className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-white/55">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function JsonBlock({ value }) {
  if (!value) return null;
  let text = value;
  try {
    text = JSON.stringify(typeof value === "string" ? JSON.parse(value) : value, null, 2);
  } catch {
    text = String(value);
  }
  return <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-[10px] leading-4 text-white/45">{text}</pre>;
}

function TransactionDetail({ row, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await invokeAdminFunction("getAdminTransactionLedger", {
          mode: "detail",
          wallet_transaction_id: row.wallet_transaction_id || undefined,
          ledger_group_id: row.ledger_group_id || undefined,
        });
        if (!cancelled) setDetail(response.data || null);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.error || "Unable to load transaction trail.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [row.key, row.wallet_transaction_id, row.ledger_group_id]);

  const tx = detail?.transaction;
  const provider = detail?.seamless_operations?.[0];
  const journal = detail?.journal_batches?.[0];

  return (
    <div className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="absolute inset-y-0 right-0 w-full max-w-3xl overflow-y-auto border-l border-white/10 bg-[#0B0B0B] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-white/[0.07] bg-[#0B0B0B]/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#C9A84C]">Transaction trail</p>
            <h2 className="mt-1 text-lg font-extrabold text-white">{humanize(row.type)} · {formatUsd(row.amount)}</h2>
            <p className="mt-1 truncate font-mono text-[10px] text-white/35">{row.transaction_id}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-white/40 hover:bg-white/5 hover:text-white" aria-label="Close transaction details">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5 pb-12">
          {loading && <div className="flex min-h-48 items-center justify-center"><Loader2 className="animate-spin text-[#C9A84C]" /></div>}
          {error && <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-300">{error}</div>}

          {!loading && detail && (
            <>
              {detail.flags?.length > 0 && (
                <div className="rounded-xl border border-red-400/20 bg-red-400/[0.07] p-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-red-300"><CircleAlert size={14} /> Review indicators</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {detail.flags.map((flag) => <StatusPill key={flag} value={flag} />)}
                  </div>
                </div>
              )}

              <Section title="Core transaction">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <DetailField label="User">{detail.user ? <><div>{detail.user.chess_com_username || detail.user.full_name || "—"}</div><div className="text-[10px] text-white/35">{detail.user.email}</div></> : "System"}</DetailField>
                  <DetailField label="Amount">{tx ? formatUsd(tx.amount) : formatUsd(row.amount)}</DetailField>
                  <DetailField label="Status"><StatusPill value={tx?.status || row.status} /></DetailField>
                  <DetailField label="Integration"><StatusPill value={tx?.integration_status || row.integration_status} /></DetailField>
                  <DetailField label="Direction">{humanize(tx?.direction || row.direction)}</DetailField>
                  <DetailField label="Source event">{tx?.source_event || row.source_event || "—"}</DetailField>
                  <DetailField label="Wallet Transaction ID"><CopyValue value={tx?.id || row.wallet_transaction_id} label="wallet transaction ID" /></DetailField>
                  <DetailField label="Correlation ID"><CopyValue value={tx?.correlation_id || row.correlation_id} label="correlation ID" /></DetailField>
                  <DetailField label="Ledger Group ID"><CopyValue value={tx?.ledger_group_id || row.ledger_group_id} label="ledger group ID" /></DetailField>
                  <DetailField label="Match ID"><CopyValue value={tx?.match_id || row.match_id} label="match ID" /></DetailField>
                  <DetailField label="Idempotency Key"><CopyValue value={tx?.idempotency_key} label="idempotency key" /></DetailField>
                  <DetailField label="Retention Until">{formatDate(tx?.retention_until)}</DetailField>
                </div>
              </Section>

              {(provider || detail.funding_source || detail.seamless_status_reconciliations?.length > 0) && (
                <Section title="Seamless / funding rail">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <DetailField label="Operation status"><StatusPill value={provider?.status || row.provider_status} /></DetailField>
                    <DetailField label="Provider reference"><CopyValue value={provider?.provider_reference_id || row.provider_reference_id} label="provider reference" /></DetailField>
                    <DetailField label="Attempts">{provider?.attempts ?? "—"}</DetailField>
                    <DetailField label="Last provider error">{provider?.last_error_code || "—"}</DetailField>
                    <DetailField label="Funding source"><CopyValue value={detail.funding_source?.source_id || tx?.funding_source_id} label="funding source ID" /></DetailField>
                    <DetailField label="Bank account">{detail.funding_source ? `${detail.funding_source.account_name || "Bank account"}${detail.funding_source.account_mask ? ` ••••${detail.funding_source.account_mask}` : ""}` : "—"}</DetailField>
                    <DetailField label="Funding source status"><StatusPill value={detail.funding_source?.status} /></DetailField>
                    <DetailField label="Seamless customer"><CopyValue value={detail.funding_source?.provider_user_id} label="Seamless customer ID" /></DetailField>
                    <DetailField label="Payment profile"><CopyValue value={detail.funding_source?.profile_id} label="payment profile ID" /></DetailField>
                    <DetailField label="ACH authorization"><CopyValue value={tx?.ach_authorization_id} label="ACH authorization ID" /></DetailField>
                    <DetailField label="Provider last status"><StatusPill value={tx?.provider_last_status || row.provider_status} /></DetailField>
                    <DetailField label="Provider checked">{formatDate(tx?.provider_last_checked_at || row.provider_last_checked_at)}</DetailField>
                  </div>

                  {detail.seamless_status_reconciliations?.length > 0 && (
                    <div className="mt-4 overflow-x-auto rounded-lg border border-white/[0.06]">
                      <table className="w-full min-w-[620px] text-[11px]">
                        <thead className="bg-white/[0.025] text-left text-[9px] uppercase tracking-wider text-white/30">
                          <tr><th className="p-2">Checked</th><th className="p-2">State</th><th className="p-2">Provider status</th><th className="p-2">Attempts</th><th className="p-2">Error</th></tr>
                        </thead>
                        <tbody>
                          {detail.seamless_status_reconciliations.map((item) => (
                            <tr key={item.id} className="border-t border-white/[0.05]">
                              <td className="p-2 text-white/45">{formatDate(item.last_checked_at)}</td>
                              <td className="p-2"><StatusPill value={item.state} /></td>
                              <td className="p-2"><StatusPill value={item.provider_status || item.normalized_status} /></td>
                              <td className="p-2 text-white/55">{item.attempt_count ?? 0}</td>
                              <td className="p-2 text-white/45">{item.last_error_code || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Section>
              )}

              <Section
                title="Internal ledger"
                right={journal && (
                  <span className={`inline-flex items-center gap-1 text-[10px] ${Math.abs(Number(journal.total_debit || 0) - Number(journal.total_credit || 0)) < 0.000001 ? "text-emerald-300" : "text-red-300"}`}>
                    {Math.abs(Number(journal.total_debit || 0) - Number(journal.total_credit || 0)) < 0.000001 ? <CircleCheck size={12} /> : <CircleAlert size={12} />}
                    {Math.abs(Number(journal.total_debit || 0) - Number(journal.total_credit || 0)) < 0.000001 ? "Balanced" : "Out of balance"}
                  </span>
                )}
              >
                {journal && (
                  <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <DetailField label="Total debit">{formatUsd(journal.total_debit)}</DetailField>
                    <DetailField label="Total credit">{formatUsd(journal.total_credit)}</DetailField>
                    <DetailField label="Leg count">{journal.leg_count ?? detail.ledger_entries?.length ?? 0}</DetailField>
                    <DetailField label="Trigger">{journal.trigger_event || "—"}</DetailField>
                  </div>
                )}
                <div className="overflow-x-auto rounded-lg border border-white/[0.06]">
                  <table className="w-full min-w-[760px] text-[11px]">
                    <thead className="bg-white/[0.025] text-left text-[9px] uppercase tracking-wider text-white/30">
                      <tr><th className="p-2">Leg</th><th className="p-2">Account</th><th className="p-2">Type</th><th className="p-2 text-right">Debit</th><th className="p-2 text-right">Credit</th><th className="p-2 text-right">Avail Δ</th><th className="p-2 text-right">Held Δ</th><th className="p-2">Resulting</th></tr>
                    </thead>
                    <tbody>
                      {(detail.ledger_entries || []).map((entry) => (
                        <tr key={entry.id} className="border-t border-white/[0.05]">
                          <td className="p-2 text-white/35">{entry.ledger_leg_index ?? "—"}</td>
                          <td className="p-2 text-white/65">{humanize(entry.ledger_account)}</td>
                          <td className="p-2 text-white/50">{humanize(entry.transaction_type)}</td>
                          <td className="p-2 text-right text-white/55">{formatUsd(entry.debit_amount)}</td>
                          <td className="p-2 text-right text-white/55">{formatUsd(entry.credit_amount)}</td>
                          <td className="p-2 text-right text-white/45">{formatUsd(entry.available_delta)}</td>
                          <td className="p-2 text-right text-white/45">{formatUsd(entry.held_delta)}</td>
                          <td className="p-2 text-white/45">{entry.resulting_total_balance == null ? "—" : formatUsd(entry.resulting_total_balance)}</td>
                        </tr>
                      ))}
                      {(!detail.ledger_entries || detail.ledger_entries.length === 0) && <tr><td colSpan={8} className="p-4 text-center text-white/25">No ledger legs recorded for this transaction.</td></tr>}
                    </tbody>
                  </table>
                </div>
                {detail.ledger_operations?.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {detail.ledger_operations.map((operation) => (
                      <div key={operation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/[0.025] px-3 py-2">
                        <div><p className="font-mono text-[10px] text-white/50">{operation.operation_id}</p><p className="text-[9px] text-white/25">{formatDate(operation.created_at)} → {formatDate(operation.completed_at)}</p></div>
                        <div className="flex items-center gap-2"><StatusPill value={operation.status} />{operation.last_error && <span className="text-[10px] text-red-300/70">{operation.last_error}</span>}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {(tx?.deposit_hold_status || tx?.payout_hold_status || detail.deposit_settlement_evidence?.length > 0) && (
                <Section title="Hold & reconciliation">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <DetailField label="Deposit hold"><StatusPill value={tx?.deposit_hold_status} /></DetailField>
                    <DetailField label="Deposit release threshold">{formatDate(tx?.deposit_release_at)}</DetailField>
                    <DetailField label="Deposit reconciliation"><StatusPill value={tx?.deposit_reconciliation_status} /></DetailField>
                    <DetailField label="Payout hold"><StatusPill value={tx?.payout_hold_status} /></DetailField>
                    <DetailField label="Payout release threshold">{formatDate(tx?.payout_release_at)}</DetailField>
                    <DetailField label="Deposit bank debit">{tx?.deposit_bank_debit == null ? "—" : formatUsd(tx.deposit_bank_debit)}</DetailField>
                    <DetailField label="Deposit processing fee">{tx?.deposit_processing_fee == null ? "—" : formatUsd(tx.deposit_processing_fee)}</DetailField>
                    <DetailField label="Pricing version">{tx?.deposit_pricing_version || "—"}</DetailField>
                    <DetailField label="Reconciliation reason">{tx?.deposit_reconciliation_reason || "—"}</DetailField>
                  </div>
                  {detail.deposit_settlement_evidence?.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {detail.deposit_settlement_evidence.map((item) => (
                        <div key={item.id} className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-white/60">{humanize(item.kind)} evidence</span><StatusPill value={item.result} /></div>
                          <div className="mt-2 grid grid-cols-2 gap-3 text-[10px] sm:grid-cols-4">
                            <DetailField label="Recorded">{formatDate(item.recorded_at)}</DetailField>
                            <DetailField label="Net received">{item.net_received == null ? "—" : formatUsd(item.net_received)}</DetailField>
                            <DetailField label="Processing fee">{item.processing_fee == null ? "—" : formatUsd(item.processing_fee)}</DetailField>
                            <DetailField label="Provider reference"><CopyValue value={item.provider_reference_id} /></DetailField>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {detail.match && (
                <Section title="Related contest">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <DetailField label="Match ID"><CopyValue value={detail.match.id} /></DetailField>
                    <DetailField label="Match status"><StatusPill value={detail.match.status} /></DetailField>
                    <DetailField label="Result">{humanize(detail.match.result)}</DetailField>
                    <DetailField label="Settlement hold">{detail.match.settlement_hold ? "Yes" : "No"}</DetailField>
                    <DetailField label="Entry amount">{detail.match.wager_amount == null ? "—" : formatUsd(detail.match.wager_amount)}</DetailField>
                    <DetailField label="Platform fee / player">{detail.match.platform_service_fee == null ? "—" : formatUsd(detail.match.platform_service_fee)}</DetailField>
                    <DetailField label="Fee schedule">{detail.match.platform_fee_schedule_version || "—"}</DetailField>
                    <DetailField label="Winner"><CopyValue value={detail.match.winner_id} /></DetailField>
                  </div>
                </Section>
              )}

              <Section title="Transaction timeline">
                <div className="space-y-0">
                  {(detail.timeline || []).map((item, index) => (
                    <div key={`${item.at}-${item.label}-${index}`} className="relative flex gap-3 pb-4 last:pb-0">
                      {index < detail.timeline.length - 1 && <div className="absolute left-[5px] top-3 h-full w-px bg-white/[0.07]" />}
                      <div className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border border-[#C9A84C]/40 bg-[#C9A84C]/20" />
                      <div className="min-w-0"><p className="text-xs text-white/65">{item.label}</p><div className="mt-1 flex flex-wrap items-center gap-2"><span className="text-[10px] text-white/30">{formatDate(item.at)}</span><StatusPill value={item.status} /></div></div>
                    </div>
                  ))}
                  {(!detail.timeline || detail.timeline.length === 0) && <p className="text-xs text-white/25">No timeline events recorded.</p>}
                </div>
              </Section>

              <Section title={`Integration events (${detail.integration_events?.length || 0})`}>
                <div className="space-y-2">
                  {(detail.integration_events || []).map((event) => (
                    <details key={event.id} className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                      <summary className="cursor-pointer list-none">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div><p className="text-xs font-medium text-white/65">{event.event_type}</p><p className="mt-0.5 text-[9px] text-white/25">{formatDate(event.occurred_at)} · {event.aggregate_type}</p></div>
                          <div className="flex gap-2"><StatusPill value={event.status} /><StatusPill value={event.delivery_state} /></div>
                        </div>
                      </summary>
                      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <DetailField label="Aggregate ID"><CopyValue value={event.aggregate_id} /></DetailField>
                        <DetailField label="Causation ID"><CopyValue value={event.causation_id} /></DetailField>
                        <DetailField label="Idempotency"><CopyValue value={event.idempotency_key} /></DetailField>
                        <DetailField label="Actor">{humanize(event.actor_type)}</DetailField>
                        <DetailField label="Delivery attempts">{event.delivery_attempts ?? 0}</DetailField>
                        <DetailField label="Delivery error">{event.last_delivery_error || "—"}</DetailField>
                      </div>
                      <JsonBlock value={event.event_data_json} />
                    </details>
                  ))}
                  {(!detail.integration_events || detail.integration_events.length === 0) && <p className="text-xs text-white/25">No integration events recorded.</p>}
                </div>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function rangeToDates(range) {
  if (range === "all") return {};
  const now = new Date();
  const start = new Date(now);
  if (range === "24h") start.setHours(start.getHours() - 24);
  if (range === "7d") start.setDate(start.getDate() - 7);
  if (range === "30d") start.setDate(start.getDate() - 30);
  return { date_from: start.toISOString(), date_to: now.toISOString() };
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export default function AdminTransactionLedger() {
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [options, setOptions] = useState({ types: [], statuses: [], provider_statuses: [] });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [sourceLimited, setSourceLimited] = useState(false);
  const [selected, setSelected] = useState(null);

  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [providerStatus, setProviderStatus] = useState("all");
  const [recordKind, setRecordKind] = useState("all");
  const [dateRange, setDateRange] = useState("30d");
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  const filterPayload = useMemo(() => ({
    search: search.trim(),
    type,
    status,
    provider_status: providerStatus,
    record_kind: recordKind,
    flagged_only: flaggedOnly,
    ...rangeToDates(dateRange),
  }), [search, type, status, providerStatus, recordKind, dateRange, flaggedOnly]);

  const load = async (requestedPage = page) => {
    setLoading(true);
    setError("");
    try {
      const response = await invokeAdminFunction("getAdminTransactionLedger", {
        mode: "list",
        page: requestedPage,
        page_size: PAGE_SIZE,
        ...filterPayload,
      });
      const data = response.data || {};
      setRows(data.rows || []);
      setSummary(data.summary || null);
      setOptions(data.filter_options || { types: [], statuses: [], provider_statuses: [] });
      setPage(data.page || requestedPage);
      setTotal(data.total || 0);
      setTotalPages(data.total_pages || 1);
      setGeneratedAt(data.generated_at || null);
      setSourceLimited(data.source_limited === true);
    } catch (err) {
      setError(err?.response?.data?.error || "Unable to load the admin transaction ledger.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
    // Initial load only. Filters are applied explicitly to avoid expensive re-querying on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = () => load(1);

  const exportCsv = async () => {
    setExporting(true);
    setError("");
    try {
      const response = await invokeAdminFunction("getAdminTransactionLedger", {
        mode: "export",
        page: 1,
        page_size: 5000,
        ...filterPayload,
      });
      const exportRows = response.data?.rows || [];
      const columns = [
        ["date", "occurred_at"], ["transaction_id", "transaction_id"], ["wallet_transaction_id", "wallet_transaction_id"],
        ["user_name", "user_name"], ["user_email", "user_email"], ["user_id", "user_id"], ["type", "type"], ["amount", "amount"],
        ["currency", "currency"], ["direction", "direction"], ["status", "status"], ["integration_status", "integration_status"],
        ["provider_status", "provider_status"], ["provider_reference_id", "provider_reference_id"], ["funding_source_mask", "funding_source_mask"],
        ["ledger_group_id", "ledger_group_id"], ["ledger_status", "ledger_status"], ["ledger_balanced", "ledger_balanced"],
        ["correlation_id", "correlation_id"], ["match_id", "match_id"], ["source_event", "source_event"], ["flags", "flags"],
      ];
      const csv = [
        columns.map(([header]) => csvEscape(header)).join(","),
        ...exportRows.map((row) => columns.map(([, key]) => csvEscape(key === "flags" ? (row.flags || []).join("|") : row[key])).join(",")),
      ].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `chessbet-admin-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err?.response?.data?.error || "Unable to export the ledger.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] px-4 pb-16 pt-7 sm:px-6">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link to="/profile" className="mb-3 inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70">
              <ArrowLeft size={14} /> Back to Profile
            </Link>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C9A84C]">Admin only</p>
            <h1 className="mt-1 text-2xl font-extrabold text-white">Transaction Ledger</h1>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-white/40">
              End-to-end visibility across player wallet transactions, internal ledger postings, Seamless ACH operations, provider status recovery, settlement evidence, and integration events.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => load(page)} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-semibold text-white/60 hover:bg-white/5 disabled:opacity-40">
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
            <button onClick={exportCsv} disabled={exporting} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#C9A84C]/25 bg-[#C9A84C]/10 px-3 text-xs font-semibold text-[#C9A84C] hover:bg-[#C9A84C]/15 disabled:opacity-40">
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Export CSV
            </button>
          </div>
        </div>

        {sourceLimited && (
          <div className="mb-4 flex gap-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.07] p-3 text-xs leading-5 text-amber-100/70">
            <CircleAlert size={15} className="mt-0.5 shrink-0" />
            The source scan reached its safety cap on at least one underlying record type. Narrow the date/search filters for complete results in that slice.
          </div>
        )}
        {error && <div className="mb-4 rounded-xl border border-red-400/20 bg-red-400/[0.07] p-3 text-xs text-red-300">{error}</div>}

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Records", summary?.total_records ?? 0, "Matching current filters"],
            ["Deposits", formatUsd(summary?.deposits), "Wallet principal"],
            ["Withdrawals", formatUsd(summary?.withdrawals), "Requested outflow"],
            ["Platform fees", formatUsd(summary?.platform_fees), "Net recorded fees"],
            ["In flight", summary?.in_flight_records ?? 0, "Pending / processing"],
            ["Flagged", summary?.flagged_records ?? 0, "Needs attention"],
          ].map(([label, value, note]) => (
            <div key={label} className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-white/30">{label}</p>
              <p className="mt-1 text-lg font-extrabold text-white">{value}</p>
              <p className="mt-0.5 text-[9px] text-white/25">{note}</p>
            </div>
          ))}
        </div>

        <div className="mb-4 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
          <div className="grid gap-2 lg:grid-cols-[minmax(260px,2fr)_repeat(5,minmax(120px,1fr))_auto]">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && applyFilters()}
                placeholder="Search user, transaction, provider, ledger, match, correlation…"
                className="h-9 w-full rounded-lg border border-white/10 bg-black/20 pl-9 pr-3 text-xs text-white placeholder:text-white/20 focus:border-[#C9A84C]/40 focus:outline-none"
              />
            </div>
            <select value={type} onChange={(event) => setType(event.target.value)} className="h-9 rounded-lg border border-white/10 bg-[#111] px-2 text-xs text-white/60 focus:outline-none">
              <option value="all">All types</option>{options.types.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}
            </select>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-lg border border-white/10 bg-[#111] px-2 text-xs text-white/60 focus:outline-none">
              <option value="all">All statuses</option>{options.statuses.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}
            </select>
            <select value={providerStatus} onChange={(event) => setProviderStatus(event.target.value)} className="h-9 rounded-lg border border-white/10 bg-[#111] px-2 text-xs text-white/60 focus:outline-none">
              <option value="all">All provider states</option>{options.provider_statuses.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}
            </select>
            <select value={recordKind} onChange={(event) => setRecordKind(event.target.value)} className="h-9 rounded-lg border border-white/10 bg-[#111] px-2 text-xs text-white/60 focus:outline-none">
              <option value="all">Wallet + system</option><option value="wallet_transaction">Wallet transactions</option><option value="ledger_batch">System ledger only</option>
            </select>
            <select value={dateRange} onChange={(event) => setDateRange(event.target.value)} className="h-9 rounded-lg border border-white/10 bg-[#111] px-2 text-xs text-white/60 focus:outline-none">
              <option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="all">All available</option>
            </select>
            <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-white/10 px-3 text-xs text-white/50"><input type="checkbox" checked={flaggedOnly} onChange={(event) => setFlaggedOnly(event.target.checked)} className="accent-[#C9A84C]" /> Flagged</label>
            <button onClick={applyFilters} disabled={loading} className="h-9 rounded-lg bg-[#C9A84C] px-4 text-xs font-bold text-black hover:opacity-90 disabled:opacity-50">Apply</button>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] text-left text-xs">
              <thead className="border-b border-white/[0.06] bg-white/[0.02] text-[9px] uppercase tracking-wider text-white/30">
                <tr>
                  <th className="p-3">Date</th><th className="p-3">User</th><th className="p-3">Type</th><th className="p-3 text-right">Amount</th><th className="p-3">ChessBet</th><th className="p-3">Provider</th><th className="p-3">Ledger</th><th className="p-3">Transaction ID</th><th className="p-3">Trail</th><th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 && <tr><td colSpan={10} className="p-14 text-center"><Loader2 className="mx-auto animate-spin text-[#C9A84C]" size={22} /></td></tr>}
                {!loading && rows.length === 0 && <tr><td colSpan={10} className="p-14 text-center text-sm text-white/25">No transactions match these filters.</td></tr>}
                {rows.map((row) => (
                  <tr key={row.key} onClick={() => setSelected(row)} className="cursor-pointer border-b border-white/[0.045] last:border-0 hover:bg-white/[0.025]">
                    <td className="p-3"><p className="whitespace-nowrap text-white/55">{formatDate(row.occurred_at)}</p><p className="mt-0.5 text-[9px] text-white/20">{row.record_kind === "ledger_batch" ? "System posting" : humanize(row.direction)}</p></td>
                    <td className="p-3"><p className="max-w-[180px] truncate font-medium text-white/70">{row.user_name}</p><p className="max-w-[180px] truncate text-[9px] text-white/30">{row.user_email || shortId(row.user_id)}</p></td>
                    <td className="p-3"><p className="text-white/65">{humanize(row.type)}</p><p className="mt-0.5 text-[9px] text-white/25">{row.source_event || "—"}</p></td>
                    <td className="p-3 text-right font-semibold text-white">{formatUsd(row.amount)}</td>
                    <td className="p-3"><StatusPill value={row.status} /><div className="mt-1"><StatusPill value={row.integration_status} /></div></td>
                    <td className="p-3"><StatusPill value={row.provider_status} />{row.funding_source_mask && <p className="mt-1 text-[9px] text-white/25">••••{row.funding_source_mask}</p>}</td>
                    <td className="p-3"><StatusPill value={row.ledger_status} /><p className={`mt-1 text-[9px] ${row.ledger_balanced === false ? "text-red-300" : "text-white/25"}`}>{row.ledger_balanced == null ? "No journal" : row.ledger_balanced ? `${row.ledger_leg_count ?? "—"} legs · balanced` : "Out of balance"}</p></td>
                    <td className="p-3 font-mono text-[10px] text-white/40">{shortId(row.transaction_id, 10, 6)}</td>
                    <td className="p-3"><div className="space-y-0.5 text-[9px] text-white/30"><p>Provider: {shortId(row.provider_reference_id)}</p><p>Group: {shortId(row.ledger_group_id)}</p><p>Match: {shortId(row.match_id)}</p></div></td>
                    <td className="p-3 text-right">{row.flags?.length > 0 ? <span title={row.flags.join(", ")}><CircleAlert size={15} className="ml-auto text-red-300" /></span> : <ChevronRight size={15} className="ml-auto text-white/15" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-3 py-2.5 text-[10px] text-white/30">
            <div>{total.toLocaleString()} matching records · Page {page} of {totalPages}{generatedAt ? ` · Refreshed ${formatDate(generatedAt)}` : ""}</div>
            <div className="flex items-center gap-1">
              <button onClick={() => load(page - 1)} disabled={page <= 1 || loading} className="rounded-md border border-white/10 p-1.5 hover:bg-white/5 disabled:opacity-25" aria-label="Previous page"><ChevronLeft size={13} /></button>
              <button onClick={() => load(page + 1)} disabled={page >= totalPages || loading} className="rounded-md border border-white/10 p-1.5 hover:bg-white/5 disabled:opacity-25" aria-label="Next page"><ChevronRight size={13} /></button>
            </div>
          </div>
        </div>

        <p className="mt-3 text-[9px] leading-4 text-white/20">
          Read-only operational view. Provider identifiers and masked funding-source details are shown for investigation; credentials, raw bank-account data, and unrestricted provider payloads are never exposed here.
        </p>
      </div>

      {selected && <TransactionDetail row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
