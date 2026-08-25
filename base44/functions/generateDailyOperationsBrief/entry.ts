import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Daily founder operations briefing for the chessbet_operations intelligence path.
//
// Investigation-only: reads operational entities via the service role and writes
// ONLY DailyOperationsBrief + OperationsFinding (both admin-only). It never
// touches funds, match outcomes, users, accounts, enforcement, compliance, or
// external messaging, and never invokes settlement/payout/refund/withdrawal
// functions. Deterministic (no AI gateway) so the founder brief is neutral
// and reproducible. Safe to run from the scheduled workflow (no user session).
//
// Idempotent per brief_date: re-runs on the same Detroit business day update the
// existing DailyOperationsBrief and reuse open OperationsFindings by key.

function detroitDateString(now = new Date()) {
  // en-CA yields ISO-style YYYY-MM-DD in the target time zone.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Detroit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STUCK_MATCH_MS = 6 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole.entities;

    // Allow manual admin invocation; scheduled runs have no user session.
    try {
      const user = await base44.auth.me();
      if (user && user.role !== 'admin') {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    } catch {
      // No user session (scheduled workflow) — allowed.
    }

    const now = new Date();
    const briefDate = detroitDateString(now);
    const sinceMs = now.getTime() - DAY_MS;

    const [
      openCases, reviewCases, openFlags, reviewFlags,
      reconciliations, manualReviewAnalyses, failedEvents, inProgressMatches,
      wallets, ledgerAccounts, settlementEntries,
    ] = await Promise.all([
      svc.DisputeCase.filter({ status: 'open' }, '-created_date', 500),
      svc.DisputeCase.filter({ status: 'under_review' }, '-created_date', 500),
      svc.IntegrityFlag.filter({ status: 'open' }, '-created_date', 500),
      svc.IntegrityFlag.filter({ status: 'under_review' }, '-created_date', 500),
      svc.SettlementReconciliation.filter({}, '-created_date', 500),
      svc.FairPlayAnalysis.filter({ status: 'manual_review' }, '-created_date', 500),
      svc.IntegrationEvent.filter({ delivery_state: 'failed' }, '-created_date', 500),
      svc.Match.filter({ status: 'in_progress' }, '-updated_date', 500),
      svc.Wallet.list(null, 5000),
      svc.SystemLedgerAccount.list(null, 100),
      svc.LedgerEntry.filter({ ledger_account: 'settlement' }, null, 5000),
    ]);

    // --- Internal ledger invariant (mirrors checkLedgerIntegrity, read-only here) ---
    const userTotalSum = wallets.reduce((s, w) => s + (w.available_balance || 0) + (w.held_balance || 0), 0);
    const revenue = ledgerAccounts.find((a) => a.account_name === 'platform_revenue')?.balance || 0;
    const suspense = ledgerAccounts.find((a) => a.account_name === 'suspense')?.balance || 0;
    const deposits = settlementEntries.filter((e) => e.transaction_type === 'deposit').reduce((s, e) => s + (e.debit_amount || 0), 0);
    const withdrawals = settlementEntries.filter((e) => e.transaction_type === 'withdrawal').reduce((s, e) => s + (e.credit_amount || 0), 0);
    const lhs = userTotalSum + revenue + suspense;
    const rhs = deposits - withdrawals;
    const ledgerDiff = Math.round((lhs - rhs) * 100) / 100;
    const ledgerBalanced = Math.abs(ledgerDiff) < 0.01;

    // --- Derived exception sets ---
    const pendingReconciliations = reconciliations.filter((r) => r.status !== 'applied');
    const recentFailedEvents = failedEvents.filter((e) => new Date(e.occurred_at || e.created_date || 0).getTime() >= sinceMs);
    const casesAwaiting = [...openCases, ...reviewCases];
    const fairPlayAwaiting = casesAwaiting.filter((c) => c.report_category === 'fair_play' || c.fair_play_review_flag);
    const highCases = casesAwaiting.filter((c) => c.escalated || c.priority === 'high');
    const highFlags = [...openFlags, ...reviewFlags].filter((f) => f.severity === 'high');
    const stuckMatches = inProgressMatches.filter((m) => {
      const t = new Date(m.updated_date || m.created_date || 0).getTime();
      return Number.isFinite(t) && (now.getTime() - t) > STUCK_MATCH_MS;
    });

    // --- Build findings (internal records only) ---
    const findings = [];
    const pushFinding = (f) => findings.push(f);

    if (!ledgerBalanced) {
      pushFinding({
        finding_key: `ledger-imbalance-${briefDate}`,
        category: 'settlement_ledger',
        priority: 'critical',
        status: 'human_approval_required',
        authority_level: 'human_approval_required',
        title: 'Internal ledger invariant failed',
        summary: `User balances + platform revenue + suspense (${lhs}) did not equal deposits - withdrawals (${rhs}). Diff: ${ledgerDiff}.`,
        evidence: `user_total=${userTotalSum}; platform_revenue=${revenue}; suspense=${suspense}; deposits=${deposits}; withdrawals=${withdrawals}; diff=${ledgerDiff}; computed_at=${now.toISOString()}`,
        recommended_next_step: 'Administrator must reconcile the contest-clearing ledger before any payout or refund. Do not initiate a second payout. Verify WalletTransaction and ledger groups for recent contests.',
        is_approval_required: true,
        related_entity_type: 'ledger_entry',
      });
    }

    for (const r of pendingReconciliations.slice(0, 20)) {
      pushFinding({
        finding_key: `reconciliation-${r.id}`,
        category: 'settlement_ledger',
        priority: 'high',
        status: 'human_approval_required',
        authority_level: 'human_approval_required',
        title: `Pending settlement reconciliation for match ${r.match_id || r.id}`,
        summary: `SettlementReconciliation ${r.id} is in status "${r.status}" with reserve_shortfall ${r.reserve_shortfall || 0}.`,
        evidence: `record=${r.id}; match_id=${r.match_id || ''}; status=${r.status}; reserve_shortfall=${r.reserve_shortfall || 0}; approved_by=${r.approved_by || ''}; notes=${(r.notes || '').slice(0, 500)}`,
        recommended_next_step: 'Administrator must verify the WalletTransaction, ledger group, wallet balances, and protected system accounts, then apply a documented correction. Do not initiate a duplicate payout.',
        is_approval_required: true,
        related_entity_type: 'settlement_reconciliation',
        related_entity_id: r.id,
        match_id: r.match_id || '',
      });
    }

    for (const e of recentFailedEvents.slice(0, 20)) {
      pushFinding({
        finding_key: `integration-failed-${e.id}`,
        category: 'production_anomaly',
        priority: 'medium',
        status: 'human_approval_required',
        authority_level: 'human_approval_required',
        title: `Failed integration delivery: ${e.event_type || e.id}`,
        summary: `IntegrationEvent ${e.id} (type ${e.event_type || 'unknown'}) is in delivery_state "failed" after ${e.delivery_attempts || 0} attempt(s).`,
        evidence: `record=${e.id}; event_type=${e.event_type || ''}; aggregate_type=${e.aggregate_type || ''}; aggregate_id=${e.aggregate_id || ''}; attempts=${e.delivery_attempts || 0}; last_error=${(e.last_delivery_error || '').slice(0, 500)}; occurred_at=${e.occurred_at || ''}`,
        recommended_next_step: 'Administrator to review the failing event and its adapter configuration before retrying delivery. No automatic retry from this agent.',
        is_approval_required: true,
        related_entity_type: 'integration_event',
        related_entity_id: e.id,
        match_id: e.match_id || '',
      });
    }

    for (const c of highCases.slice(0, 20)) {
      pushFinding({
        finding_key: `dispute-high-${c.id}`,
        category: 'dispute',
        priority: 'high',
        status: 'human_approval_required',
        authority_level: 'human_approval_required',
        title: `High-priority dispute case #CB-${String(c.case_number || '').padStart(6, '0')}`,
        summary: `DisputeCase ${c.id} is ${c.escalated ? 'escalated' : 'high priority'} and ${c.status}.`,
        evidence: `record=${c.id}; case_number=${c.case_number || ''}; category=${c.report_category || ''}; status=${c.status}; priority=${c.priority || 'medium'}; assigned=${c.assigned_admin_id || ''}; created=${c.created_date || ''}`,
        recommended_next_step: 'Administrator to review the evidence packet and screening, then resolve the case manually. This agent never resolves disputes.',
        is_approval_required: true,
        related_entity_type: 'dispute_case',
        related_entity_id: c.id,
        match_id: c.match_id || '',
      });
    }

    for (const f of highFlags.slice(0, 20)) {
      pushFinding({
        finding_key: `integrity-high-${f.id}`,
        category: f.flag_type === 'engine_assistance_suspected' ? 'fair_play' : 'other',
        priority: 'high',
        status: 'human_approval_required',
        authority_level: 'human_approval_required',
        title: `High-severity integrity flag: ${(f.flag_type || 'manual').replaceAll('_', ' ')}`,
        summary: `IntegrityFlag ${f.id} (user ${f.user_id || 'n/a'}) is open/under_review with high severity.`,
        evidence: `record=${f.id}; flag_type=${f.flag_type || ''}; severity=${f.severity || 'low'}; status=${f.status}; user_id=${f.user_id || ''}; match_id=${f.match_id || ''}`,
        recommended_next_step: 'Administrator to corroborate with fair-play screening, account history, and contest evidence before any enforcement action. This agent never takes enforcement action.',
        is_approval_required: true,
        related_entity_type: 'integrity_flag',
        related_entity_id: f.id,
        match_id: f.match_id || '',
      });
    }

    for (const m of stuckMatches.slice(0, 20)) {
      pushFinding({
        finding_key: `stuck-match-${m.id}`,
        category: 'match_health',
        priority: 'medium',
        status: 'open',
        authority_level: 'autonomous',
        title: `Possibly stuck in-progress match ${m.id}`,
        summary: `Match ${m.id} has been in_progress with no updates for over 6 hours.`,
        evidence: `record=${m.id}; status=${m.status}; player1=${m.player1_id || ''}; player2=${m.player2_id || ''}; time_control=${m.time_control || ''}; last_updated=${m.updated_date || ''}`,
        recommended_next_step: 'Investigate the associated Game clock, heartbeats, and move log. If confirmed abandoned, follow the published abandonment/timeout policy (human approval for any match-outcome change).',
        is_approval_required: false,
        related_entity_type: 'match',
        related_entity_id: m.id,
        match_id: m.id,
      });
    }

    const newLowRiskCount = stuckMatches.length + manualReviewAnalyses.length + Math.max(0, casesAwaiting.length - highCases.length);

    // --- Persist findings (reuse open finding by key to avoid duplicates) ---
    const findingIds = [];
    for (const f of findings) {
      try {
        const existing = await svc.OperationsFinding.filter({ finding_key: f.finding_key }, '-created_date', 1);
        if (existing && existing.length > 0) {
          findingIds.push(existing[0].id);
          continue;
        }
        const created = await svc.OperationsFinding.create(f);
        findingIds.push(created.id);
      } catch {
        // Never let a single finding write abort the whole brief.
      }
    }

    // --- Compose brief ---
    const criticalApprovals = findings.filter((f) => f.status === 'human_approval_required' && (f.priority === 'critical' || f.priority === 'high')).length;
    const moneyExceptions = findings.filter((f) => f.category === 'settlement_ledger').length;
    const productionAnomalies = recentFailedEvents.length;
    const materialExceptionsFound = findings.filter((f) => f.status === 'human_approval_required').length > 0;

    const lines = [];
    lines.push(`# ChessBet Operations Brief — ${briefDate}`);
    lines.push('');
    lines.push(`Generated: ${now.toISOString()} (run_mode: live, America/Detroit 09:00)`);
    lines.push('');
    if (!materialExceptionsFound && stuckMatches.length === 0) {
      lines.push('## No material exceptions found.');
      lines.push('');
    }
    lines.push(`## Critical approvals required: ${criticalApprovals}`);
    lines.push(`## High-priority investigations: ${highCases.length + highFlags.length}`);
    lines.push(`## Money/ledger exceptions: ${moneyExceptions} (ledger ${ledgerBalanced ? 'balanced' : `IMBALANCED (diff ${ledgerDiff})`})`);
    lines.push(`## Fair-play/dispute cases awaiting review: ${fairPlayAwaiting.length} fair-play-linked (${casesAwaiting.length} total disputes), ${manualReviewAnalyses.length} analyses in manual_review`);
    lines.push(`## Production anomalies: ${productionAnomalies} failed integration deliveries (last 24h)`);
    lines.push(`## Match health: ${stuckMatches.length} possibly stuck in-progress matches`);
    lines.push(`## New low-risk items: ${newLowRiskCount}`);
    lines.push('');
    if (findings.length > 0) {
      lines.push('## Findings');
      for (const f of findings) {
        lines.push(`- [${f.priority}] ${f.title} — ${f.status}${f.is_approval_required ? ' (human approval required)' : ''}`);
      }
    }
    const summaryMarkdown = lines.join('\n');

    const headline = materialExceptionsFound
      ? `${criticalApprovals} critical/high approval(s) required, ${moneyExceptions} money/ledger exception(s)`
      : 'No material exceptions found';

    // --- Update-or-create the daily brief (idempotent per brief_date) ---
    let briefId;
    try {
      const existing = await svc.DailyOperationsBrief.filter({ brief_date: briefDate }, '-generated_at', 1);
      const payload = {
        generated_at: now.toISOString(),
        run_mode: 'live',
        material_exceptions_found: materialExceptionsFound,
        headline,
        summary_markdown: summaryMarkdown,
        critical_approval_count: criticalApprovals,
        high_priority_investigation_count: highCases.length + highFlags.length,
        money_ledger_exception_count: moneyExceptions,
        fair_play_dispute_awaiting_review_count: fairPlayAwaiting.length,
        production_anomaly_count: productionAnomalies,
        resolved_low_risk_count: 0,
        new_low_risk_count: newLowRiskCount,
        ledger_balanced: ledgerBalanced,
        ledger_diff: ledgerDiff,
        finding_ids: findingIds,
      };
      if (existing && existing.length > 0) {
        const upd = await svc.DailyOperationsBrief.update(existing[0].id, payload);
        briefId = upd.id;
      } else {
        const created = await svc.DailyOperationsBrief.create({ brief_date: briefDate, ...payload });
        briefId = created.id;
      }
    } catch (e) {
      return Response.json({ error: e.message || 'Failed to persist brief' }, { status: 500 });
    }

    return Response.json({
      brief_id: briefId,
      brief_date: briefDate,
      headline,
      material_exceptions_found: materialExceptionsFound,
      counts: {
        critical_approvals: criticalApprovals,
        high_priority_investigations: highCases.length + highFlags.length,
        money_ledger_exceptions: moneyExceptions,
        fair_play_dispute_awaiting_review: fairPlayAwaiting.length,
        production_anomalies: productionAnomalies,
        stuck_matches: stuckMatches.length,
        new_low_risk: newLowRiskCount,
      },
      ledger: { balanced: ledgerBalanced, diff: ledgerDiff, lhs, rhs },
      finding_ids: findingIds,
      notice: 'Investigation-only. No funds, match outcomes, users, or accounts were modified. Approval-required items require human action.',
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Brief generation failed' }, { status: 500 });
  }
});