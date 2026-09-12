
/** Email-safe HTML: explicit block spacing survives clients that collapse raw newlines. */
export function formatHealthEmail(checks: any[], checkedAt: string, digest = false, recovered = false, activity: any = null) {
  const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
  const status = overall(checks);
  const themes: Record<string, { title: string; color: string; background: string }> = {
    critical: { title: 'CRITICAL — Immediate attention', color: '#991b1b', background: '#fef2f2' },
    warning: { title: 'WARNING — Needs attention', color: '#92400e', background: '#fffbeb' },
    unknown: { title: 'UNKNOWN — Verification needed', color: '#334155', background: '#f1f5f9' },
    healthy: { title: 'HEALTHY — Measured checks passed', color: '#166534', background: '#f0fdf4' },
  };
  const theme = themes[status] || themes.unknown;
  const attention = checks.filter(c => c.status === 'critical' || c.status === 'warning')
    .sort((a, b) => (a.status === 'critical' ? 0 : 1) - (b.status === 'critical' ? 0 : 1));
  const unknown = checks.filter(c => c.status === 'unknown');
  const healthy = checks.filter(c => c.status === 'healthy');
  let checked = checkedAt;
  const timestamp = new Date(checkedAt);
  if (Number.isFinite(timestamp.getTime())) checked = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Detroit', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(timestamp);
  const actions: Record<string, string> = {
    credits: 'Review Base44 Usage and the upcoming credit allowance.',
    seamless_bank_pending: 'Review pending bank records and verify that funding-source webhooks are arriving.',
    seamless_bank_failures: 'Review failed or expired Seamless bank-verification records.',
    stalled_games: 'Review overdue clocks and the timeout workflow.',
    analyzer_backlog: 'Check the analyzer queue and recent processing times.',
    analyzer_failed: 'Review the failed analysis records and analyzer logs.',
    integration_failures: 'Review failed delivery records.',
    seamless_recovery: 'Review the recorded recovery exceptions.',
    public_site: 'Check the public website and DigitalOcean uptime monitor.',
    financial_redis: 'Check the financial Redis service and connection configuration.',
    rating_redis: 'Check the rating Redis service and connection configuration.',
    analyzer_http: 'Check the analyzer health endpoint and DigitalOcean app status.',
  };
  const cards = (items: any[], compact = false) => items.map(c => {
    const color = (themes[c.status] || themes.unknown).color;
    return '<tr><td style="padding:14px 0;border-bottom:1px solid #e2e8f0;">' +
      '<p style="margin:0 0 6px;font-size:16px;font-weight:bold;">' + escape(c.label) +
      ' <span style="font-size:12px;color:' + color + ';">[' + escape(c.status.toUpperCase()) + ']</span></p>' +
      '<p style="margin:0;font-size:14px;line-height:1.6;color:#475569;">' + escape(c.summary) + '</p>' +
      (!compact && actions[c.key] ? '<p style="margin:8px 0 0;font-size:14px;line-height:1.5;"><strong>Next step:</strong> ' + escape(actions[c.key]) + '</p>' : '') +
      '</td></tr>';
  }).join('');
  const section = (title: string, items: any[], empty: string, compact = false) =>
    '<h2 style="margin:28px 0 4px;font-size:19px;line-height:1.4;">' + title + ' (' + items.length + ')</h2>' +
    (items.length ? '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">' + cards(items, compact) + '</table>' :
      '<p style="margin:10px 0;font-size:14px;line-height:1.6;color:#475569;">' + empty + '</p>');
  const money = (value: unknown) => '$' + Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const activityTime = (value: unknown) => {
    const date = new Date(String(value || ''));
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Detroit', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(date) : '';
  };
  const metric = (label: string, value: unknown, detail = '') => '<td width="50%" valign="top" style="padding:10px 8px;border-bottom:1px solid #e2e8f0;">' +
    '<p style="margin:0 0 3px;font-size:12px;color:#64748b;">' + escape(label) + '</p>' +
    '<p style="margin:0;font-size:20px;font-weight:bold;color:#0f172a;">' + escape(value) + '</p>' +
    (detail ? '<p style="margin:3px 0 0;font-size:12px;line-height:1.4;color:#64748b;">' + escape(detail) + '</p>' : '') + '</td>';
  let activityHtml = '';
  if (digest && activity) {
    if (activity.unavailable) {
      activityHtml = '<h2 style="margin:28px 0 8px;font-size:19px;">Last 24 hours</h2>' +
        '<p style="margin:0;padding:12px;background:#fff7ed;border-left:4px solid #c2410c;font-size:14px;line-height:1.6;">' + escape(activity.reason || 'Activity totals are unavailable.') + '</p>';
    } else {
      const traffic = activity.traffic?.available
        ? metric('Site visits', activity.traffic.sessions, 'GA4 sessions') + metric('Page views', activity.traffic.pageViews, activity.traffic.newUsers + ' new visitor(s)')
        : metric('Site visits', 'Unavailable', activity.traffic?.reason || 'GA4 could not be verified') + metric('New registrations', activity.registrations);
      const trafficRows = activity.traffic?.available
        ? '<tr>' + traffic + '</tr><tr>' + metric('New registrations', activity.registrations) + metric('Location checks', activity.locations.checks, activity.locations.uniqueUsers + ' unique user(s)') + '</tr>'
        : '<tr>' + traffic + '</tr><tr>' + metric('Location checks', activity.locations.checks, activity.locations.uniqueUsers + ' unique user(s)') + metric('ID verifications approved', activity.identity.verified, activity.identity.rejected + ' rejected · ' + activity.identity.review + ' review') + '</tr>';
      const wagerRows = (activity.matches.breakdown || []).map((row: any) => '<tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:14px;">' + money(row.entryAmount) + '</td>' +
        '<td align="right" style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:14px;">' + escape(row.created) + '</td>' +
        '<td align="right" style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:14px;">' + escape(row.accepted) + '</td>' +
        '<td align="right" style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:14px;">' + escape(row.completed) + '</td></tr>').join('');
      activityHtml = '<h2 style="margin:28px 0 4px;font-size:19px;">Last 24 hours</h2>' +
        '<p style="margin:0 0 12px;font-size:12px;color:#64748b;">' + escape(activityTime(activity.window.start)) + ' → ' + escape(activityTime(activity.window.end)) + ' Detroit time · 24 most recently completed hours</p>' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">' + trafficRows +
        '<tr>' + metric('ID verifications approved', activity.identity.verified, activity.identity.verifiedUsers + ' unique user(s)') + metric('Bank accounts connected', activity.banks.connected, activity.banks.verified + ' verified') + '</tr>' +
        '<tr>' + metric('Players who deposited', activity.funding.depositingPlayers, activity.funding.depositEvents + ' deposit event(s)') + metric('Deposited', money(activity.funding.depositVolume), activity.funding.depositReturns ? money(activity.funding.depositReturns) + ' returned' : 'principal credited') + '</tr>' +
        '<tr>' + metric('Matches created', activity.matches.created, 'avg entry ' + money(activity.matches.avgEntryAmountCreated)) + metric('Matches accepted', activity.matches.accepted, activity.matches.completed + ' completed') + '</tr>' +
        '<tr>' + metric('Players in created/accepted matches', activity.matches.uniquePlayers) + metric('Platform revenue', money(activity.platformRevenue), 'net ledger revenue in window') + '</tr>' +
        '</table>' +
        '<p style="margin:18px 0 6px;font-size:14px;font-weight:bold;">Location outcomes</p>' +
        '<p style="margin:0;font-size:14px;line-height:1.6;color:#475569;">' + escape(activity.locations.approved) + ' approved · ' + escape(activity.locations.blocked) + ' blocked · ' + escape(activity.locations.unresolved) + ' unresolved/failed.</p>' +
        '<p style="margin:18px 0 6px;font-size:14px;font-weight:bold;">Match entry amounts</p>' +
        (wagerRows ? '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><th align="left" style="padding:6px 0;font-size:12px;color:#64748b;">Entry amount</th><th align="right" style="font-size:12px;color:#64748b;">Created</th><th align="right" style="font-size:12px;color:#64748b;">Accepted</th><th align="right" style="font-size:12px;color:#64748b;">Completed</th></tr>' + wagerRows + '</table>' : '<p style="margin:0;font-size:14px;color:#64748b;">No match activity in this window.</p>') +
        '<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#64748b;">Financial amounts come from validated balanced journal batches. Location and onboarding figures are aggregate counts only; no personal location or identity data is included.</p>';
    }
  }
  const kind = digest ? 'Daily health + activity' : recovered ? 'Recovery update' : 'Health alert';
  const body = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:16px;background:#f3f4f6;color:#0f172a;font-family:Arial,Helvetica,sans-serif;">' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #e2e8f0;"><tr><td style="padding:24px;">' +
    '<p style="margin:0 0 12px;font-size:14px;color:#475569;">CHESSBET · ' + kind + '</p>' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:20px;background:' + theme.background + ';border-left:5px solid ' + theme.color + ';">' +
    '<p style="margin:0 0 6px;font-size:12px;font-weight:bold;color:' + theme.color + ';">OVERALL HEALTH</p>' +
    '<h1 style="margin:0;font-size:26px;line-height:1.3;color:' + theme.color + ';">' + escape(theme.title) + '</h1>' +
    '<p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#334155;">' + attention.length + ' need attention · ' + unknown.length + ' unverified · ' + healthy.length + ' passed</p></td></tr></table>' +
    '<p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:#64748b;">Checked ' + escape(checked) + ' (Detroit time)</p>' +
    (recovered ? '<p style="margin:16px 0;padding:12px;background:#f0fdf4;font-size:14px;line-height:1.6;">Previously alerted checks recovered. Any unverified checks below still need confirmation.</p>' : '') +
    activityHtml +
    section('Needs attention', attention, 'No warning or critical findings in this report.') +
    section('Not yet verified', unknown, 'No unknown checks in this report.', true) +
    section('Checks passed', healthy, 'No checks are confirmed healthy in this report.', true) +
    '<p style="margin:28px 0 18px;"><a href="https://worldchessbet.com/admin/health" style="display:inline-block;padding:13px 18px;background:#0f172a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;">Open Site Health dashboard</a></p>' +
    '<p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">This is a snapshot, not a capacity guarantee. Unknown means insufficient evidence, not confirmed downtime. Monitoring observes and reports; it does not change games, money, accounts, or infrastructure.</p>' +
    '</td></tr></table></td></tr></table></body></html>';
  return { subject: digest ? 'ChessBet daily: ' + status.toUpperCase() + ' health + activity' : 'ChessBet health: ' + status.toUpperCase() + (recovered ? ' — recovery' : ' — ' + attention.length + ' need attention'), body };
}

// Bound serialized size as well as entry count: the storage bridge can reject
// a growing string before the schema's declared maxLength is reached.
export const HISTORY_JSON_BUDGET = 16000;
export function boundedHealthHistory(previous: unknown, latest: any) {
  const source = Array.isArray(previous) ? previous : [];
  const compact = [...source.slice(-23), latest].filter(h => h && typeof h === 'object').map(h => ({
    at: h.at, status: h.status,
    values: Object.fromEntries(Object.entries(h.values || {}).map(([key, value]: [string, any]) => [
      key, { status: value?.status,
        ...(value?.value != null ? { value: value.value } : {}),
        ...(value?.latency_ms != null ? { latency_ms: value.latency_ms } : {}) },
    ])),
  }));
  while (compact.length > 1 && JSON.stringify(compact).length > HISTORY_JSON_BUDGET) compact.shift();
  if (JSON.stringify(compact).length > HISTORY_JSON_BUDGET) {
    // The full current checks remain in checks_json even if one future history
    // entry becomes unusually large. Never truncate JSON or fail collection.
    return [{ at: latest.at, status: latest.status, values: {}, history_details_omitted: true }];
  }
  return compact;
}

export const STALE_MS = 35 * 60_000;
export const ALERT_COOLDOWN_MS = 60 * 60_000;
export function parseJson(value: unknown, fallback: any) {
  try { return JSON.parse(String(value || '')); } catch { return fallback; }
}
export function timeMs(value: unknown) {
  if (!value) return NaN;
  const s = String(value);
  return Date.parse(/Z$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z');
}
export function check(key: string, label: string, status: string, summary: string, value: number | null = null, unit = '', latency_ms: number | null = null) {
  return { key, label, status, summary, value, unit, latency_ms };
}
export function overall(checks: any[]) {
  if (!checks.length) return 'unknown';
  if (checks.some(c => c.status === 'critical')) return 'critical';
  if (checks.some(c => c.status === 'warning')) return 'warning';
  if (checks.some(c => c.status === 'unknown')) return 'unknown';
  return 'healthy';
}
export function creditCheck(config: any, now: number) {
  const observed = timeMs(config.credit_observed_at);
  const started = timeMs(config.credit_cycle_started_at);
  const renewal = timeMs(config.credit_renews_at);
  const used = config.credit_used, allowance = config.credit_allowance;
  if (!Number.isFinite(observed) || now - observed > 24 * 60 * 60_000 || observed > now + 60_000 ||
      !Number.isFinite(used) || used < 0 || !Number.isFinite(allowance) || allowance <= 0 || renewal <= now ||
      !Number.isFinite(started) || !Number.isFinite(renewal) || started >= observed) {
    return check('credits', 'Base44 shared credits', 'unknown', 'A fresh workspace credit reading is needed. Credit usage is not available through the connected SDK; update the admin health settings from the Base44 usage dashboard.');
  }
  const remaining = Math.max(0, allowance - used);
  const elapsedDays = Math.max(1, (observed - started) / 86400000);
  const perDay = used / elapsedDays;
  const daysRemaining = (renewal - now) / 86400000;
  const estimatedRemainingNow = Math.max(0, remaining - perDay * Math.max(0, now - observed) / 86400000);
  const projectedExhaustion = perDay > 0 && estimatedRemainingNow / perDay < daysRemaining;
  const nextCycleRisk = config.pending_credit_allowance > 0 && perDay * 30 > config.pending_credit_allowance;
  const status = used >= allowance ? 'critical' : remaining / allowance < 0.2 || projectedExhaustion || nextCycleRisk ? 'warning' : 'healthy';
  return check('credits', 'Base44 shared credits', status,
    'Manually observed workspace usage: ' + used + ' / ' + allowance + '. ' +
    (projectedExhaustion ? 'At the cycle-average rate, credits may run out before renewal. ' : 'Current estimate fits this cycle. ') +
    (config.pending_credit_allowance > 0 && config.pending_credit_allowance < allowance ? 'A lower allowance of ' + config.pending_credit_allowance + ' is scheduled for the next cycle. ' : '') +
    (nextCycleRisk ? 'The recent daily average would exceed the scheduled next-cycle allowance over 30 days. ' : '') +
    'Forecast is approximate and includes all workspace apps; it is not a gameplay capacity limit.', remaining, 'credits');
}
export function percentile(values: number[], fraction = 0.95) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}
export function telemetryChecks(records: any[], activeGames: number | null, now: number) {
  const samples: any[] = records.filter(r => now - timeMs(r.recorded_at) <= 15 * 60_000)
    .flatMap(r => parseJson(r.samples_json, []));
  return ['submitMove', 'getGameClock', 'gameHeartbeat'].map(name => {
    const relevant = samples.filter(s => s.name === name);
    const count = relevant.reduce((n, s) => n + s.count, 0);
    const failures = relevant.reduce((n, s) => n + s.server_errors + s.network_errors, 0);
    const throttled = relevant.reduce((n, s) => n + s.rate_limits, 0);
    const slow = relevant.reduce((n, s) => n + s.slow_count, 0);
    const key = 'gameplay_' + name;
    if (!count) return check(key, name + ' responsiveness', 'unknown',
      activeGames === 0 ? 'No active games or recent browser measurements. No gameplay performance claim is made.' : 'No recent browser measurements. Confirm the monitoring client is published and reporting.');
    const ratio = failures / count;
    // Coarse, bounded aggregate data is a user-reported signal, never authoritative evidence for enforcement.
    const status = ratio >= 0.1 && count >= 20 ? 'critical' : throttled >= 3 || (failures >= 3 && ratio >= 0.02) || (count >= 20 && slow / count >= 0.05) ? 'warning' : 'healthy';
    return check(key, name + ' responsiveness', status,
      count + ' browser-reported calls; ' + failures + ' network/server failures, ' + throttled +
      ' rate limits, ' + slow + ' responses over 2 seconds. Latest per-player samples reported within 15 minutes; client-reported and potentially incomplete.',
      count, 'sampled calls');
  });
}
export function alertSignature(checks: any[]) {
  return checks.filter(c => c.status === 'warning' || c.status === 'critical')
    .map(c => c.key + ':' + c.status).sort().join('|');
}
export function shouldNotify(previous: any, checks: any[], now: number) {
  const signature = alertSignature(checks);
  const previousSignature = previous?.last_alert_signature || '';
  const lastAttempt = timeMs(previous?.last_alert_attempt_at);
  const cooldown = !Number.isFinite(lastAttempt) || now - lastAttempt >= ALERT_COOLDOWN_MS;
  const recovered = previousSignature !== '' && signature === '' &&
    previousSignature.split('|').every((s: string) => checks.some(c => c.key === s.split(':')[0] && c.status === 'healthy'));
  // Unknown/missing evidence is never called a recovery.
  const changed = signature !== previousSignature && (signature !== '' || recovered);
  const retryUnconfirmed = signature !== '' && previous?.alert_delivery === 'failed_or_unknown';
  return { send: cooldown && (changed || retryUnconfirmed), signature, recovered };
}
export function staleSnapshot(snapshot: any, now: number) {
  return !snapshot || !Number.isFinite(timeMs(snapshot.checked_at)) || now - timeMs(snapshot.checked_at) > STALE_MS;
}
export function healthSummary(snapshot: any, now = Date.now()) {
  if (staleSnapshot(snapshot, now)) return { status: 'unknown', summary: 'Health monitoring data is missing or over 35 minutes old. Check the Site Health Monitoring workflow.', checks: [] };
  const checks = parseJson(snapshot.checks_json, []);
  return { status: overall(checks), summary: checks.filter((c: any) => c.status !== 'healthy').map((c: any) => c.label + ': ' + c.status).join('; ') || 'All measured checks passed.', checks };
}
