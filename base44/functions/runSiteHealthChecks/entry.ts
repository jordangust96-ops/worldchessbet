import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { check, overall, creditCheck, parseJson, telemetryChecks, timeMs, shouldNotify } from '../../shared/siteHealthPolicy.ts';

// Single scheduled writer. No agent tool can invoke this collector. No
// transactions, identity evaluations, analysis jobs, financial Redis keys,
// account changes, or gameplay writes are performed by monitoring.
let running = false;
async function deadline<T>(work: Promise<T>, ms = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([work, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('monitor_timeout')), ms); })]); }
  finally { clearTimeout(timer!); }
}
async function httpProbe(key: string, label: string, url: string, json = false) {
  const started = Date.now();
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(6000) });
    let valid = response.status === 200;
    if (json) {
      const data = await response.json().catch(() => null);
      valid = valid && !!data && (data.ok === true || data.status === 'ok' || data.status === 'healthy' || data.healthy === true);
    } else {
      const html = await response.text();
      valid = valid && /chessbet/i.test(html) && /<html/i.test(html);
    }
    const ms = Date.now() - started;
    return check(key, label, !valid ? 'critical' : ms > 2500 ? 'warning' : 'healthy',
      !valid ? 'Health response failed validation (HTTP ' + response.status + ').' :
      'Valid response in ' + ms + ' ms. This is a lightweight availability check, not a full user journey.',
      null, '', ms);
  } catch { return check(key, label, 'critical', 'The health request timed out, redirected unexpectedly, or failed.', null, '', Date.now() - started); }
}
async function redisProbe(prefix: string, key: string, label: string) {
  const started = Date.now();
  try {
    const urlText = (Deno.env.get(prefix + '_REST_URL') || '').trim();
    const token = (Deno.env.get(prefix + '_REST_TOKEN') || '').trim();
    if (!urlText || !token) return check(key, label, 'unknown', 'Health credentials are not configured.');
    const url = new URL(urlText);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.upstash.io') || url.username || url.password || url.port || url.search || url.hash)
      return check(key, label, 'critical', 'The configured Redis endpoint has an unsupported URL shape.');
    const r = await fetch(url, { method: 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(['PING']), signal: AbortSignal.timeout(6000) });
    const data = await r.json().catch(() => null), ms = Date.now() - started;
    const ok = r.ok && data?.result === 'PONG' && !data?.error;
    return check(key, label, !ok ? 'critical' : ms > 1000 ? 'warning' : 'healthy',
      ok ? 'Authenticated read-only PING succeeded in ' + ms + ' ms; no keys were changed.' : 'Authenticated read-only PING failed.',
      null, '', ms);
  } catch { return check(key, label, 'critical', 'Redis health check failed or timed out.', null, '', Date.now() - started); }
}
async function collect(svc: any, config: any, previous: any, now: number) {
  const checks: any[] = [], since = new Date(now - 86400000).toISOString();
  async function read(key: string, label: string, work: () => Promise<any>, derive: (rows: any[]) => any) {
    try { checks.push(derive(await deadline(work()))); }
    catch { checks.push(check(key, label, 'unknown', 'The bounded read failed or timed out. No healthy result can be inferred.')); }
  }
  const jobs = [
    async () => { checks.push(await httpProbe('public_site', 'Public website', 'https://worldchessbet.com/')); },
    async () => { checks.push(await redisProbe('SEAMLESS_ATOMIC_REDIS', 'financial_redis', 'Financial Redis')); },
    async () => { checks.push(await redisProbe('RATING_ATOMIC_REDIS', 'rating_redis', 'Rating Redis')); },
    async () => {
      if (Deno.env.get('FAIR_PLAY_SCREENING_ENABLED') !== 'true') {
        checks.push(check('analyzer_http', 'Fair-play analyzer endpoint', 'unknown', 'Screening is disabled; the monitor does not enable it.')); return;
      }
      const raw = Deno.env.get('FAIR_PLAY_ANALYZER_URL') || '';
      try {
        const url = new URL('/health', raw);
        if (url.protocol !== 'https:' || !(url.hostname.endsWith('.ondigitalocean.app') || url.hostname === 'engine.worldchessbet.com') || url.username || url.password)
          throw new Error('invalid_endpoint');
        checks.push(await httpProbe('analyzer_http', 'Fair-play analyzer endpoint', url.toString(), true));
      } catch { checks.push(check('analyzer_http', 'Fair-play analyzer endpoint', 'unknown', 'Analyzer health URL is missing or unsupported.')); }
    },
    async () => {
      const started = Date.now();
      await read('active_games', 'Active games / Base44 data', () => svc.Game.filter({ launch_epoch: 2, status: 'active' }, '-created_date', 501), rows => {
        const capped = rows.length >= 501, players = rows.length * 2;
        const baseline = config.tested_concurrent_players || 0;
        return check('active_games', 'Active games / Base44 data', capped || (baseline > 0 && players >= baseline * 0.7) ? 'warning' : 'healthy',
          (capped ? 'At least ' : '') + rows.length + ' active games. ' +
          (baseline > 0 ? 'Recorded tested capacity: ' + baseline + ' players; warn at 70%.' : 'No load-tested player capacity is recorded; this is a count, not a capacity guarantee.'),
          rows.length, capped ? 'games (lower bound)' : 'games', Date.now() - started);
      });
    },
    async () => read('stalled_games', 'Overdue game clocks', () => svc.Game.filter({ launch_epoch: 2, status: 'active', turn_started_at: { $lt: new Date(now - 10 * 60000).toISOString() } }, 'turn_started_at', 501), rows => {
      const expired = rows.filter(g => {
        const remaining = g.fen?.split(' ')[1] === 'b' ? g.black_time_ms : g.white_time_ms;
        return Number.isFinite(remaining) && now - timeMs(g.turn_started_at) > remaining + 10 * 60000;
      }).length;
      return check('stalled_games', 'Overdue game clocks', expired || rows.length >= 501 ? 'warning' : 'healthy',
        expired + ' sampled active games have clocks overdue by over 10 minutes. ' + (rows.length >= 501 ? 'Scan limit reached; count is a lower bound. ' : '') +
        'Investigate the timeout workflow; the monitor never changes a game result.', expired, 'games');
    }),
    async () => read('analyzer_backlog', 'Fair-play analysis backlog', () => svc.FairPlayAnalysis.filter({ status: { $in: ['queued', 'processing', 'awaiting_analyzer'] } }, 'created_date', 501), rows => {
      const overdue = rows.filter(r => now - timeMs(r.created_date) > 15 * 60000).length;
      const prior = parseJson(previous?.checks_json, []).find((c: any) => c.key === 'analyzer_backlog');
      const growth = prior?.value != null && rows.length > prior.value;
      return check('analyzer_backlog', 'Fair-play analysis backlog', overdue > 0 || rows.length >= 501 ? 'warning' : 'healthy',
        rows.length + ' pending analyses; ' + overdue + ' older than 15 minutes. ' +
        (growth ? 'Backlog increased since the previous check. ' : '') +
        (rows.length >= 501 ? 'Scan limit reached; count is a lower bound.' : ''), rows.length, 'analyses');
    }),
    async () => read('analyzer_failed', 'Recent analyzer failures', () => svc.FairPlayAnalysis.filter({ status: 'failed', updated_date: { $gte: since } }, '-updated_date', 501), rows =>
      check('analyzer_failed', 'Recent analyzer failures', rows.length ? 'warning' : 'healthy', rows.length + ' failed analyses updated in the last 24 hours. No re-analysis is triggered.', rows.length, 'failures')),
    async () => read('integration_failures', 'Integration delivery failures', () => svc.IntegrationEvent.filter({ delivery_state: 'failed', updated_date: { $gte: since } }, '-updated_date', 501), rows =>
      check('integration_failures', 'Integration delivery failures', rows.length ? 'warning' : 'healthy',
        rows.length + ' failed outbox deliveries updated in the last 24 hours. This is not proof of provider webhook availability.', rows.length, 'failures')),
    async () => read('seamless_recovery', 'Seamless recovery exceptions', () => svc.SeamlessStatusReconciliation.filter({ state: { $in: ['retryable_error', 'manual_review'] } }, '-updated_date', 501), rows =>
      check('seamless_recovery', 'Seamless recovery exceptions', rows.length ? 'warning' : 'healthy',
        rows.length + ' recorded recovery exceptions. Monitoring reads saved results only and does not contact a payment endpoint.', rows.length, 'exceptions')),
    async () => read('socure_failures', 'Socure technical failures', () => svc.SocureIdentityVerification.filter({ status: 'failed', requested_at: { $gte: since } }, '-requested_at', 501), rows =>
      check('socure_failures', 'Socure technical failures', rows.length ? 'warning' : 'healthy',
        rows.length + ' failed verification requests from the last 24 hours. Rejections and human review decisions are not counted as outages.', rows.length, 'failures')),
    async () => read('socure_overdue', 'Socure overdue pending sessions', () => svc.SocureIdentityVerification.filter({ status: 'pending', expires_at: { $lt: new Date(now - 60 * 60000).toISOString() } }, '-requested_at', 501), rows =>
      check('socure_overdue', 'Socure overdue pending sessions', rows.length ? 'warning' : 'healthy',
        rows.length + ' pending records are over one hour past their saved expiry. This is a reconciliation signal, not proof of provider downtime.', rows.length, 'sessions')),
  ];
  // Bounded concurrency prevents the monitor from creating its own request burst.
  let index = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (index < jobs.length) await jobs[index++]();
  }));
  try {
    const records = await deadline(svc.GameHealthTelemetry.filter({ recorded_at: { $gte: new Date(now - 15 * 60000).toISOString() } }, '-recorded_at', 501));
    checks.push(...telemetryChecks(records, checks.find(c => c.key === 'active_games')?.value ?? null, now));
    if (records.length >= 501) checks.push(check('telemetry_coverage', 'Gameplay telemetry coverage', 'warning', 'Telemetry scan reached 501 reporting players; displayed metrics cover a bounded sample.'));
  } catch { checks.push(check('gameplay_telemetry', 'Gameplay responsiveness', 'unknown', 'Browser telemetry is unavailable.')); }
  checks.push(creditCheck(config, now));
  checks.push(check('digitalocean_metrics', 'DigitalOcean resource alerts', 'unknown',
    config.digitalocean_alert_status === 'configured' ? 'Native resource alerts are configured separately. Live CPU and memory readings are not imported into this dashboard.' : 'Native CPU/memory alerts still need the requested mailbox verified. Live infrastructure metrics are not connected.'));
  checks.push(check('external_monitor', 'Independent uptime monitoring', config.external_monitor_status === 'configured' ? 'healthy' : 'unknown',
    config.external_monitor_status === 'configured' ? 'Independent monitoring was configured. This records setup, not its latest probe result; check DigitalOcean for current external observations.' : 'Independent monitoring is not yet verified. A Base44 outage can also stop this collector.'));
  return checks.sort((a, b) => a.key.localeCompare(b.key));
}
Deno.serve(async (req) => {
  let ownsRun = false;
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const persist = body.persist === true;
    if (running) return Response.json({ skipped: true, reason: 'run_in_progress' });
    running = true; ownsRun = true;
    const svc = base44.asServiceRole.entities;
    const [configs, snapshots] = await Promise.all([
      svc.SiteHealthConfig.filter({ key: 'current' }, '-updated_date', 1),
      svc.SiteHealthSnapshot.filter({ key: 'current' }, '-checked_at', 1),
    ]);
    const config = configs[0], previous = snapshots[0];
    if (!config?.enabled) return Response.json({ skipped: true, reason: 'monitoring_disabled' });
    const now = Date.now();
    if (persist && previous && now - timeMs(previous.checked_at) < 12 * 60000)
      return Response.json({ skipped: true, reason: 'minimum_collection_interval' });
    const checks = await collect(svc, config, previous, now);
    const status = overall(checks), checkedAt = new Date().toISOString();
    if (!persist) return Response.json({ status, checked_at: checkedAt, checks, persisted: false, email_sent: false });
    const history = parseJson(previous?.history_json, []).slice(-23);
    history.push({ at: checkedAt, status, values: Object.fromEntries(checks.map(c => [c.key, { status: c.status, value: c.value, latency_ms: c.latency_ms }])) });
    const notification = shouldNotify(previous, checks, now);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Detroit', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
    const part = (type: string) => parts.find(p => p.type === type)?.value || '';
    const date = part('year') + '-' + part('month') + '-' + part('day');
    const digest = part('hour') === '09' && previous?.last_digest_date !== date;
    const send = config.alerts_enabled === true && config.alert_email === 'hello@worldchessbet.com' && (notification.send || digest);
    const payload: any = {
      key: 'current', checked_at: checkedAt, status, checks_json: JSON.stringify(checks), history_json: JSON.stringify(history),
      last_alert_attempt_at: previous?.last_alert_attempt_at || '', last_alert_sent_at: previous?.last_alert_sent_at || '',
      last_alert_signature: previous?.last_alert_signature || '', alert_delivery: previous?.alert_delivery || 'not_sent',
      last_digest_date: previous?.last_digest_date || '',
    };
    // Record the attempt before sending. An ambiguous email failure is never
    // immediately retried; it is shown as unconfirmed and limited by cooldown.
    if (send) {
      payload.last_alert_attempt_at = checkedAt;
      payload.last_alert_signature = notification.signature;
      payload.alert_delivery = 'failed_or_unknown';
      if (digest) payload.last_digest_date = date;
    }
    let saved = previous ? await svc.SiteHealthSnapshot.update(previous.id, payload) : await svc.SiteHealthSnapshot.create(payload);
    let emailAccepted = false;
    if (send) {
      const relevant = digest ? checks : checks.filter(c => c.status !== 'healthy');
      const bodyText = ['ChessBet health report', 'Checked: ' + checkedAt, 'Overall: ' + status,
        notification.recovered ? 'Previously alerted checks recovered. Any unknown checks still require verification.' : '',
        ...relevant.map(c => c.label + ' [' + c.status + ']: ' + c.summary),
        'Review: https://worldchessbet.com/admin/health',
        'Monitoring is observational. No money, gameplay, account, provider settings, or infrastructure changes were made.'].filter(Boolean).join('\n\n');
      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: 'hello@worldchessbet.com',
          subject: 'ChessBet health: ' + (digest ? 'daily summary' : notification.recovered ? 'recovery' : status),
          body: bodyText,
        });
        emailAccepted = true;
        saved = await svc.SiteHealthSnapshot.update(saved.id, { last_alert_sent_at: checkedAt, alert_delivery: 'accepted' });
      } catch {
        // The provider may have accepted an email even if the response was lost.
        console.warn(JSON.stringify({ event: 'health_alert_delivery_unconfirmed' }));
      }
    }
    console.log(JSON.stringify({ event: 'site_health_check', status, checks: checks.length, persisted: true, email_accepted: emailAccepted }));
    return Response.json({ status, checked_at: checkedAt, checks, persisted: true, email_accepted: emailAccepted, snapshot_id: saved.id });
  } catch {
    console.error(JSON.stringify({ event: 'site_health_collection_failed' }));
    return Response.json({ error: 'Health collection failed; previous data must be treated as stale after 35 minutes.' }, { status: 503 });
  } finally { if (ownsRun) running = false; }
});
