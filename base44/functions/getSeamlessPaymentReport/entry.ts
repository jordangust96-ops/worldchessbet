import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { requireAdminMfa } from '../../shared/mfa.ts';
import { seamlessRequest, buildCheckLookupPath } from '../../shared/seamlessAch.ts';
import { buildPaymentReport, providerObservation, text } from '../../shared/seamlessPaymentReport.js';

// Fully paginate each source. Refuse oversized/incomplete scans instead of presenting a false reconciliation.
async function readAll(entity, query = {}) {
  const rows = [], seen = new Set();
  for (let offset = 0; offset < 20000; offset += 500) {
    const page = await entity.filter(query, 'created_date', 500, offset);
    for (const row of page) {
      if (!row.id || seen.has(row.id)) throw Error('source_pagination_changed');
      seen.add(row.id); rows.push(row);
    }
    if (page.length < 500) return rows;
  }
  throw Error('source_safety_limit');
}

Deno.serve(async req => {
  try {
    if (req.method !== 'POST') return Response.json({error:'Method not allowed'}, {status:405});
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me().catch(() => null);
    const body = await req.json().catch(() => ({}));
    const denied = await requireAdminMfa(base44, admin, body.mfaSessionToken, req.headers.get('user-agent') || '');
    if (denied) return denied;
    const service = base44.asServiceRole.entities;
    const [transactions, references, banks, profiles, events, evidence, observations] = await Promise.all([
      readAll(service.WalletTransaction, {type:{$in:['deposit','withdrawal']}}),
      readAll(service.IntegrationReference, {provider_key:'seamless_ach'}),
      readAll(service.SeamlessBankAccount),
      readAll(service.SeamlessPaymentProfile),
      readAll(service.IntegrationEvent, {event_type:'seamless.merchant_balance.transaction_status'}),
      readAll(service.DepositSettlementEvidence),
      readAll(service.SeamlessPaymentObservation),
    ]);
    const rows = buildPaymentReport({transactions,references,banks,profiles,events,evidence});
    if (body.action === 'refresh_provider') {
      const id = text(body.provider_reference_id);
      const matches = rows.filter(row => row.provider_reference_id === id);
      if (!id || !matches.length) return Response.json({error:'Known provider reference required'}, {status:400});
      if (matches.length !== 1 || matches[0].flags.includes('provider_id_reused')) return Response.json({error:'Ambiguous provider reference; review required'}, {status:409});
      // Only this hardcoded GET can reach Seamless. Never accept URLs or payment instructions from the client.
      const result = providerObservation(await seamlessRequest('GET', buildCheckLookupPath(id)), matches[0]);
      const {flags, ...safe} = result;
      // Append-only observations retain what the provider actually returned at each refresh.
      await service.SeamlessPaymentObservation.create({...safe,source:'seamless_check_api',checked_by:admin.id});
      return Response.json({observation:result,financial_records_changed:false,provider_submission:false});
    }
    if (body.action && body.action !== 'list') return Response.json({error:'Unsupported action'}, {status:400});
    const latest = new Map();
    for (const o of observations) {
      if (!latest.has(o.provider_reference_id) || Date.parse(o.checked_at) > Date.parse(latest.get(o.provider_reference_id).checked_at)) latest.set(o.provider_reference_id,o);
    }
    for (const row of rows) {
      const o = latest.get(row.provider_reference_id);
      if (!o) continue;
      Object.assign(row, {dashboard_number:text(o.dashboard_number),provider_amount:o.provider_amount,
        provider_status:text(o.provider_status),provider_checked_at:o.checked_at,
        provider_label:text(o.provider_label),provider_description:text(o.provider_description,500)});
      row.flags = row.flags.filter(f => f !== 'provider_amount_unverified');
      if (row.requested_bank_amount != null && row.requested_bank_amount !== o.provider_amount) row.flags.push('provider_amount_mismatch');
      if (row.label && o.provider_label && !row.label.split(' | ').includes(o.provider_label)) row.flags.push('provider_label_mismatch');
      if (Date.now() - Date.parse(o.checked_at) > 86400000) row.flags.push('provider_evidence_older_than_24h');
      if (row.audit_reported_amount != null && row.audit_reported_amount !== o.provider_amount) row.flags.push('historical_audit_amount_mismatch');
    }
    return Response.json({rows,generated_at:new Date().toISOString(),source_complete:true,
      scope:'All stored ChessBet payment links, merchant transfer notifications and provider charge notifications. This is not a complete Seamless statement or a certification of the merchant balance.',
      note:'Reference statuses are historical snapshots. Current wallet and provider statuses are displayed separately. Missing fees, net proceeds and settlement dates remain unknown until evidenced.',
      source_counts:{transactions:transactions.length,references:references.length,merchant_events:events.length,observations:observations.length}});
  } catch (error) {
    const code = text(error?.message,128);
    console.error(JSON.stringify({event:'payment_tracking_report_failed',code}));
    const known = ['source_safety_limit','source_pagination_changed','provider_reference_mismatch','provider_currency_mismatch','provider_amount_invalid'];
    return Response.json({error:known.includes(code) ? code : 'Unable to load payment evidence; no financial records were changed.'}, {status:503});
  }
});
