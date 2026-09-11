import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const usd = value => '$' + Number(value || 0).toFixed(2);
export default function DepositReconciliationPanel() {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState('');
  const [kind, setKind] = useState('settlement');
  const [values, setValues] = useState({});
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const tx = rows.find(row => row.id === selected);
  const load = async (skip = page * 100) => {
    try {
      const res = await base44.functions.invoke('reconcileDepositSettlement', { action: 'list', skip });
      setRows(res.data?.transactions || []);
      setHasMore(Boolean(res.data?.hasMore));
    } catch {
      setMessage('Could not load deposit reconciliation. Please refresh.');
    }
  };
  useEffect(() => { load(page * 100); }, [page]);
  const reset = () => { setValues({}); setConfirmed(false); setMessage(''); };
  const fields = kind === 'settlement'
    ? [['bankDebit', 'Actual bank charge'], ['processingFee', 'Actual Seamless processing fee'], ['netReceived', 'Actual net received by ChessBet']]
    : [['processingFeeRetained', 'Processing fee retained after return'], ['returnFee', 'Additional Seamless return charge'], ['additionalCashDebit', 'Total processor costs after return, excluding wallet principal']];
  const submit = async event => {
    event.preventDefault();
    setBusy(true); setMessage('');
    try {
      const res = await base44.functions.invoke('reconcileDepositSettlement', {
        action: kind === 'settlement' ? 'recordSettlement' : 'recordReturn',
        transactionId: selected, ...values, confirmedAgainstSeamless: confirmed,
      });
      setMessage(res.data?.message || 'Reconciliation saved.');
      await load();
      setConfirmed(false);
    } catch (error) {
      setMessage(error?.response?.data?.error || error?.data?.error || 'Verification did not complete. Check the evidence and try again.');
    } finally { setBusy(false); }
  };
  return (
    <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-white">
      <h2 className="text-lg font-semibold">Deposit reconciliation</h2>
      <p className="mt-2 text-sm text-white/60">
        Verify new deposits against a Seamless settlement statement or written support confirmation.
        A payment marked Processed is also checked before wallet credit and release.
        A transaction-level fee of $0.00 is not proof that Seamless charged no processing fee.
      </p>
      <div className="mt-4 flex gap-2 items-center">
        <Button type="button" variant="outline" disabled={busy} onClick={() => load()}>Refresh deposits</Button>
        <Button type="button" variant="outline" disabled={busy || page === 0} onClick={() => { reset(); setSelected(''); setPage(page - 1); }}>Previous</Button>
        <Button type="button" variant="outline" disabled={busy || !hasMore} onClick={() => { reset(); setSelected(''); setPage(page + 1); }}>Next</Button>
      </div>
      {rows.length === 0 ? <p className="mt-4 text-sm text-white/50">No deposits using the fee feature on this page.</p> : (
        <form className="mt-4 space-y-4" onSubmit={submit}>
          <label className="block text-sm">Deposit
            <select className="mt-1 w-full rounded border border-white/20 bg-[#151515] p-2"
              value={selected} disabled={busy} required onChange={event => { setSelected(event.target.value); reset(); }}>
              <option value="">Select a deposit</option>
              {rows.map(row => <option key={row.id} value={row.id}>
                {usd(row.amount)} · {row.created_date?.slice(0, 10)} · {row.status} · {row.reconciliation_status} · {row.id}
              </option>)}
            </select>
          </label>
          {tx && <>
            <div className="rounded-lg bg-black/20 p-3 text-sm space-y-1">
              <p>Seamless payment ID: <span className="break-all">{tx.provider_reference_id || 'Awaiting provider reference'}</span></p>
              <p>Authorized: bank charge {usd(tx.bank_debit)} · processor fee {usd(tx.processing_fee)} · wallet credit {usd(tx.amount)}</p>
              <p>Settlement: {tx.reconciliation_status.replaceAll('_', ' ')} · Return fees: {(tx.return_reconciliation_status || 'not reviewed').replaceAll('_', ' ')}</p>
              {tx.reconciliation_reason && <p className="text-amber-300">Review reason: {tx.reconciliation_reason.replaceAll('_', ' ')}</p>}
            </div>
            <label className="block text-sm">Review
              <select className="mt-1 w-full rounded border border-white/20 bg-[#151515] p-2" value={kind}
                disabled={busy} onChange={event => { setKind(event.target.value); reset(); }}>
                <option value="settlement">Settlement amounts</option>
                <option value="return">Returned or failed deposit — processor costs</option>
              </select>
            </label>
            {kind === 'return' && <p className="text-sm text-white/60">
              Record the actual unrecovered processor costs across this deposit and its return.
              Wallet principal is reversed separately. These entries do not charge the player again.
            </p>}
            <div className="grid gap-3 sm:grid-cols-3">
              {fields.map(([key, label]) => <label key={key} className="block text-sm">{label} (USD)
                <Input className="mt-1 bg-black/20 text-white" type="number" min="0" step="0.01"
                  required disabled={busy} value={values[key] || ''}
                  onChange={event => setValues({ ...values, [key]: event.target.value })} />
              </label>)}
            </div>
            <label className="block text-sm">Evidence source
              <select className="mt-1 w-full rounded border border-white/20 bg-[#151515] p-2" required
                value={values.source || ''} disabled={busy} onChange={event => setValues({ ...values, source: event.target.value })}>
                <option value="">Select source</option>
                <option value="seamless_statement">Seamless settlement statement</option>
                <option value="seamless_support">Written Seamless support confirmation</option>
              </select>
            </label>
            <label className="block text-sm">Statement reference and line/date, or support case reference
              <Input className="mt-1 bg-black/20 text-white" required minLength={8} maxLength={1000}
                disabled={busy} value={values.evidenceReference || ''}
                onChange={event => setValues({ ...values, evidenceReference: event.target.value })} />
            </label>
            <label className="flex gap-2 items-start text-sm text-white/70">
              <input type="checkbox" required disabled={busy} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />
              I checked these actual amounts against the referenced Seamless evidence for this payment.
            </label>
            <Button type="submit" disabled={busy || !confirmed}>{busy ? 'Verifying…' : 'Verify and record evidence'}</Button>
            <p className="text-xs text-white/50">An exact settlement match credits the requested wallet amount into clearing. The existing hold and final status check still apply.</p>
          </>}
        </form>
      )}
      {message && <p className="mt-4 text-sm text-amber-200" role="status">{message}</p>}
    </section>
  );
}
