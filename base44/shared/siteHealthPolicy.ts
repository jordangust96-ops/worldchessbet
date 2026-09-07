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
  const status = used >= allowance ? 'critical' : remaining / allowance < 0.2 || projectedExhaustion ? 'warning' : 'healthy';
  return check('credits', 'Base44 shared credits', status,
    'Manually observed workspace usage: ' + used + ' / ' + allowance + '. ' +
    (projectedExhaustion ? 'At the cycle-average rate, credits may run out before renewal. ' : 'Current estimate fits this cycle. ') +
    (config.pending_credit_allowance > 0 && config.pending_credit_allowance < allowance ? 'A lower allowance of ' + config.pending_credit_allowance + ' is scheduled for the next cycle. ' : '') +
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
