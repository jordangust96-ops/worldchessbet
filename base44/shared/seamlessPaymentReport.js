// Read-only joins: audit snapshots are never rewritten and no amounts are inferred.
export const text = (v, max = 255) => String(v ?? '').trim().slice(0, max);
export const json = v => { try { return typeof v === 'string' ? JSON.parse(v) : v || {}; } catch { return {}; } };
const when = r => Date.parse(r.updated_at || r.updated_date || r.occurred_at || r.created_date || '') || 0;
export const money = v => {
  if (v == null || v === '' || !['string','number'].includes(typeof v)) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && Math.abs(n * 100 - Math.round(n * 100)) < 0.000001 ? Math.round(n * 100) / 100 : null;
};
const terminal = s => ['completed','settled','failed','reversed','released'].includes(s);
const labelRef = r => text(r.external_reference_id).startsWith('chessbet-');
const unique = a => [...new Set(a.filter(Boolean))];
export function buildPaymentReport({transactions = [], references = [], banks = [], profiles = [], events = [], evidence = []}) {
  const byTx = new Map(), byProvider = new Map();
  for (const r of references) {
    if (r.provider_key !== 'seamless_ach') continue;
    const id = r.wallet_transaction_id || (r.internal_entity_type === 'wallet_transaction' ? r.internal_entity_id : '');
    if (!id) continue;
    byTx.set(id, [...(byTx.get(id) || []), r]);
    if (!labelRef(r)) byProvider.set(r.external_reference_id, unique([...(byProvider.get(r.external_reference_id) || []), id]));
  }
  const txIds = new Set(transactions.map(t => t.id));
  const rows = transactions.filter(t => ['deposit','withdrawal'].includes(t.type) &&
    (byTx.has(t.id) || t.funding_source_id || String(t.source_event || '').startsWith('seamless_'))).map(t => {
    const refs = byTx.get(t.id) || [];
    const providerIds = unique(refs.filter(r => !labelRef(r)).map(r => r.external_reference_id));
    const labels = unique(refs.filter(labelRef).map(r => r.external_reference_id));
    const bank = banks.find(b => b.source_id === t.funding_source_id && b.user_id === t.user_id);
    const profile = profiles.find(p => p.user_id === t.user_id);
    const proof = evidence.filter(e => e.wallet_transaction_id === t.id);
    const flags = [];
    if (!labels.length) flags.push('missing_payment_label');
    if (labels.some(l => l !== 'chessbet-' + t.type + '-' + t.id)) flags.push('label_mismatch');
    if (providerIds.length > 1) flags.push('multiple_provider_ids');
    if (providerIds.some(id => (byProvider.get(id) || []).length > 1)) flags.push('provider_id_reused');
    if (!providerIds.length && ['submitted','settled','uncertain'].includes(t.integration_status)) flags.push('missing_provider_id');
    if (!bank) flags.push('missing_bank_link');
    if (!profile?.provider_user_id) flags.push('missing_customer_link');
    if (bank?.provider_user_id && profile?.provider_user_id && bank.provider_user_id !== profile.provider_user_id) flags.push('customer_link_mismatch');
    if (refs.some(r => r.user_id && r.user_id !== t.user_id)) flags.push('reference_user_mismatch');
    if (terminal(t.status) && refs.some(r => ['submitting','submitted','pending'].includes(r.status))) flags.push('reference_snapshot_stale');
    if (t.integration_status === 'uncertain') flags.push('provider_outcome_unknown');
    if (proof.some(e => e.result === 'mismatch')) flags.push('settlement_evidence_mismatch');
    if (t.type === 'deposit' && t.status === 'completed' && !proof.some(e => e.kind === 'settlement' && e.result === 'matched')) flags.push('net_settlement_unverified');
    const settled = proof.filter(e => e.kind === 'settlement' && e.result === 'matched').sort((a,b) => when(b)-when(a))[0];
    return {
      key: 'wallet:' + t.id, category: 'player_' + t.type, created_at: t.created_date || '',
      wallet_transaction_id: t.id, label: labels.join(' | '), provider_reference_id: providerIds.length === 1 ? providerIds[0] : '',
      provider_reference_ids: providerIds.join(' | '), dashboard_number: '', user_id: t.user_id || '',
      provider_customer_id: profile?.provider_user_id || bank?.provider_user_id || '',
      funding_source_id: t.funding_source_id || '', bank_name: text(bank?.account_name),
      bank_last_four: /^\d{4}$/.test(String(bank?.account_mask || '')) ? String(bank.account_mask) : '',
      ach_authorization_id: t.ach_authorization_id || '', ledger_group_id: t.ledger_group_id || '',
      idempotency_key: t.idempotency_key || '', principal: money(t.amount),
      requested_bank_amount: t.type === 'deposit' ? money(t.deposit_bank_debit) : money(t.amount),
      player_fee: money(t.type === 'deposit' ? t.deposit_processing_fee : t.withdrawal_request_fee),
      net_received: money(settled?.net_received), processing_fee: money(settled?.processing_fee),
      status: t.status || '', integration_status: t.integration_status || '',
      provider_status: t.provider_last_status || '', provider_checked_at: t.provider_last_checked_at || '',
      settled_at: '', ledger_processed_at: t.processed_at || '',
      evidence_references: unique(proof.map(e => e.evidence_reference)).join(' | '),
      reference_statuses: refs.map(r => r.external_reference_id + ': ' + r.status).join(' | '),
      description: text(t.description, 500), flags,
    };
  });
  // Group lifecycle notifications by immutable provider ID, never sum repeated callbacks.
  const treasury = new Map();
  for (const e of events) {
    const d = json(e.event_data_json);
    const id = text(d.provider_ref || e.aggregate_id);
    if (!id) continue;
    treasury.set(id, [...(treasury.get(id) || []), e]);
  }
  for (const [id, group] of treasury) {
    const ordered = group.sort((a,b) => when(b)-when(a));
    const e = ordered[0], d = json(e.event_data_json);
    const description = text(d.description,500);
    const category = /fee/i.test(description) ? 'provider_charge' : 'merchant_transfer';
    rows.push({
      key:'provider:' + id, category, created_at:e.occurred_at || e.created_date,
      provider_reference_id:id, provider_reference_ids:id, dashboard_number:text(d.dashboard_number),
      description, status:e.status || '', provider_status:e.status || '',
      principal:null, requested_bank_amount:null, player_fee:null, net_received:null, processing_fee:null,
      audit_reported_amount:e.amount ?? null, audit_event_ids:unique(group.map(x=>x.id)).join(' | '),
      provider_reported_amount:text(d.provider_amount_reported),
      flags:['provider_amount_unverified', ...(ordered.some(x => x.id !== e.id && x.status === 'processed') && e.status !== 'processed' ? ['status_history_conflict'] : [])],
    });
  }
  for (const [id, refs] of byTx) {
    if (txIds.has(id)) continue;
    rows.push({key:'orphan:'+id,category:'unmatched_reference',wallet_transaction_id:id,
      provider_reference_ids:unique(refs.filter(r=>!labelRef(r)).map(r=>r.external_reference_id)).join(' | '),
      label:unique(refs.filter(labelRef).map(r=>r.external_reference_id)).join(' | '),
      status:'review',flags:['missing_wallet_transaction'],created_at:refs[0]?.created_date || ''});
  }
  return rows.sort((a,b)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0));
}
export function providerObservation(data, row) {
  const c = data?.check || data?.data?.check;
  if (!c || data?.success === false || text(c.check_id || c.id) !== row.provider_reference_id) throw Error('provider_reference_mismatch');
  if (c.currency != null && c.currency !== 'USD') throw Error('provider_currency_mismatch');
  const amount = money(c.amount);
  if (amount == null) throw Error('provider_amount_invalid');
  const flags = [];
  if (row.requested_bank_amount != null && amount !== row.requested_bank_amount) flags.push('provider_amount_mismatch');
  if (row.label && c.label && !row.label.split(' | ').includes(c.label)) flags.push('provider_label_mismatch');
  return {provider_reference_id:row.provider_reference_id, dashboard_number:text(c.number),
    provider_amount:amount, provider_status:text(c.status,64), provider_label:text(c.label),
    provider_description:text(c.description,500), checked_at:new Date().toISOString(), flags};
}
// Quote every CSV cell and neutralize spreadsheet formulas, including leading whitespace.
export function reportCsv(rows) {
  const keys = unique(rows.flatMap(r => Object.keys(r))).filter(k => k !== 'key');
  const cell = v => {
    let s = Array.isArray(v) ? v.join(' | ') : String(v ?? '');
    if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"','""') + '"';
  };
  return [keys.map(cell).join(','), ...rows.map(r => keys.map(k=>cell(r[k])).join(','))].join('\r\n');
}
