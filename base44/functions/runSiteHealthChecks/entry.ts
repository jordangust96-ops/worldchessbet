import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { check, overall, creditCheck, parseJson, telemetryChecks, timeMs, shouldNotify, formatHealthEmail, boundedHealthHistory } from '../../shared/siteHealthPolicy.ts';
import { buildActivityMetrics, inRange, journalLegs, readAll, PRODUCTION_START } from '../../shared/siteActivityMetrics.js';
import { isWalletLocationEvidence } from '../../shared/walletOnboardingLocation.ts';

// Single scheduled writer. No agent tool can invoke this collector. No
// transactions, provider enrollments, analysis jobs, financial Redis keys,
// account changes, or gameplay writes are performed by monitoring.
let running = false;
async function deadline<T>(work: Promise<T>, ms = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([work, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('monitor_timeout')), ms); })]); }
  finally { clearTimeout(timer!); }
}
async function timedFetch(url: string | URL, options: RequestInit) {
  // Base44's fetch bridge does not accept every native RequestInit option.
  // Bound the wait without passing an AbortSignal across that bridge.
  return await deadline((async () => {
    const response = await fetch(String(url), { ...options, redirect: 'manual' });
    const text = await response.text();
    return { status: response.status, ok: response.ok, text: async () => text, json: async () => JSON.parse(text) };
  })(), 6000);
}
function probeFailure(error: any) {
  const message = String(error?.message || '');
  const category = /not defined|not a function|not supported|unsupported/i.test(message) ? 'monitor_runtime_unsupported' : /monitor_timeout/.test(message) || error?.name === 'AbortError' ? 'timeout' : error?.name === 'TypeError' ? 'request_type_error_' + ['redirect', 'signal', 'url', 'header', 'fetch', 'argument', 'serialize'].filter(word => message.toLowerCase().includes(word)).join('_') : 'request_failed';
  return { category, status: category === 'monitor_runtime_unsupported' ? 'unknown' : 'critical' };
}
async function httpProbe(key: string, label: string, url: string, json = false) {
  const started = Date.now();
  try {
    const response = await timedFetch(url, { method: 'GET', redirect: 'error' });
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
  } catch (error) { const failure = probeFailure(error); return check(key, label, failure.status, 'Health probe could not complete (' + failure.category + ').', null, '', Date.now() - started); }
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
    const r = await timedFetch(url, { method: 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(['PING']) });
    const data = await r.json().catch(() => null), ms = Date.now() - started;
    const ok = r.ok && data?.result === 'PONG' && !data?.error;
    return check(key, label, !ok ? 'critical' : ms > 1000 ? 'warning' : 'healthy',
      ok ? 'Authenticated read-only PING succeeded in ' + ms + ' ms; no keys were changed.' : 'Authenticated read-only PING failed.',
      null, '', ms);
  } catch (error) { const failure = probeFailure(error); return check(key, label, failure.status, 'Redis health probe could not complete (' + failure.category + ').', null, '', Date.now() - started); }
}
const DAY_MS = 24 * 60 * 60 * 1000;
function detroitParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Detroit', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
}
function localDateKey(date: Date) {
  const p = detroitParts(date); return `${p.year}-${p.month}-${p.day}`;
}
function localHourKey(date: Date) {
  const p = detroitParts(date); return `${p.year}${p.month}${p.day}${p.hour}`;
}
function activityRange(now: number) {
  // The scheduler lands a few minutes after the hour. Report the 24 most
  // recently completed hours so internal metrics and GA4 share a stable window.
  const end = new Date(now); end.setUTCMinutes(0, 0, 0);
  const start = new Date(+end - DAY_MS);
  const dayKeys: string[] = [];
  for (let t = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()); t <= +end; t += DAY_MS)
    dayKeys.push(new Date(t).toISOString().slice(0, 10));
  return { start, end, dayKeys };
}
function amount(value: any) {
  const n = Number(value ?? 0); if (!Number.isFinite(n)) throw new Error('invalid_activity_money');
  return Math.round(n * 100) / 100;
}
async function dailyGa4(base44: any, range: any) {
  const propertyId = String(Deno.env.get('GA4_PROPERTY_ID') || '').trim();
  if (!propertyId) return { available: false, reason: 'GA4 property ID is not configured.' };
  let accessToken = '';
  try { accessToken = (await base44.asServiceRole.connectors.getConnection('google_analytics'))?.accessToken || ''; }
  catch { return { available: false, reason: 'Google Analytics connector is not connected.' }; }
  if (!accessToken) return { available: false, reason: 'Google Analytics access token is unavailable.' };
  try {
    const response = await deadline(fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: localDateKey(range.start), endDate: localDateKey(new Date(+range.end - 1)) }],
        dimensions: [{ name: 'dateHour' }],
        metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }, { name: 'newUsers' }],
        dimensionFilter: { filter: { fieldName: 'hostName', inListFilter: { values: ['worldchessbet.com', 'www.worldchessbet.com'] } } },
        limit: 100,
      }),
    }), 12000);
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) return { available: false, reason: `GA4 report failed (${response.status}).` };
    const startKey = localHourKey(range.start), endKey = localHourKey(range.end);
    let sessions = 0, pageViews = 0, newUsers = 0;
    for (const row of data.rows || []) {
      const key = row?.dimensionValues?.[0]?.value || '';
      if (key < startKey || key >= endKey) continue;
      sessions += Number(row?.metricValues?.[0]?.value || 0);
      pageViews += Number(row?.metricValues?.[1]?.value || 0);
      newUsers += Number(row?.metricValues?.[2]?.value || 0);
    }
    return { available: true, sessions: Math.round(sessions), pageViews: Math.round(pageViews), newUsers: Math.round(newUsers) };
  } catch { return { available: false, reason: 'GA4 report request did not complete.' }; }
}
async function collectDailyActivity(base44: any, now: number) {
  const range = activityRange(now), svc = base44.asServiceRole.entities;
  const sinceProduction = { launch_epoch: 2, created_date: { $gte: PRODUCTION_START } };
  const specs: any[] = [
    ['users','User',{},['id','created_date']],
    ['matches','Match',sinceProduction,['id','created_date','launch_epoch','status','wager_amount','preparation_started_at','completed_at','player1_id','player2_id']],
    ['transactions','WalletTransaction',sinceProduction,['id','created_date','launch_epoch','user_id','type','amount','status','integration_status','source_event','deposit_hold_status']],
    ['journals','LedgerJournalBatch',sinceProduction,['id','created_date','created_at','launch_epoch','ledger_group_id','wallet_transaction_id','trigger_event','legs_json','leg_count','total_credit','total_debit']],
    ['declines','MatchDeclineLog',{ created_date: { $gte: range.start.toISOString(), $lt: range.end.toISOString() } },['id','created_date','match_id']],
    ['wallets','Wallet',{},['id','created_date','available_balance','held_balance']],
    ['locations','JurisdictionVerificationLog',{},['id','created_date','user_id','provider','verification_result','pre_bypass_verification_result','geolocation_enforcement_enabled','enforcement_bypassed','vpn_or_proxy_detected','ip_address','detected_country','detected_state','trigger_event','verified_at','country_confidence','subdivision_confidence','accuracy_radius_km']],
    ['identities','SocureIdentityVerification',{ environment: 'production' },['id','created_date','user_id','status','environment','completed_at','requested_at','expires_at']],
    ['banks','SeamlessBankAccount',{},['id','created_date','updated_date','user_id','source_id','status','added_at','verified_at']],
  ];
  const sources: any = {};
  for (let i = 0; i < specs.length; i += 3) await Promise.all(specs.slice(i, i + 3).map(async ([key, entity, query, fields]) => {
    sources[key] = await readAll(svc[entity], query, fields);
  }));
  const metrics = buildActivityMetrics(sources, range, isWalletLocationEvidence, new Date(now));
  const legs = journalLegs(sources.journals).filter((row: any) => inRange(row.occurred_at, range.start, range.end));
  const depositLegs = legs.filter((row: any) => row.ledger_account === 'user_account' && Number(row.total_deposited_delta || 0) > 0);
  const locationRows = sources.locations.filter((row: any) => inRange(row.verified_at, range.start, range.end));
  const approved = locationRows.filter((row: any) => row.verification_result === 'approved' && row.enforcement_bypassed !== true).length;
  const blocked = locationRows.filter((row: any) => row.verification_result === 'blocked' && row.enforcement_bypassed !== true).length;
  const byTrigger: any = {};
  for (const row of locationRows) {
    const key = String(row.trigger_event || 'unknown').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60) || 'unknown';
    byTrigger[key] = (byTrigger[key] || 0) + 1;
  }
  const created = sources.matches.filter((row: any) => inRange(row.created_date, range.start, range.end));
  const accepted = sources.matches.filter((row: any) => inRange(row.preparation_started_at, range.start, range.end));
  const breakdown = new Map<string, any>();
  const bucket = (value: any) => {
    const entryAmount = amount(value), key = entryAmount.toFixed(2);
    if (!breakdown.has(key)) breakdown.set(key, { entryAmount, created: 0, accepted: 0, completed: 0 });
    return breakdown.get(key);
  };
  for (const match of sources.matches) {
    if (inRange(match.created_date, range.start, range.end)) bucket(match.wager_amount).created++;
    if (inRange(match.preparation_started_at, range.start, range.end)) bucket(match.wager_amount).accepted++;
    if (match.status === 'completed' && inRange(match.completed_at, range.start, range.end)) bucket(match.wager_amount).completed++;
  }
  return {
    window: { start: range.start.toISOString(), end: range.end.toISOString() },
    traffic: await dailyGa4(base44, range), registrations: metrics.internal.registrations,
    locations: { checks: locationRows.length, uniqueUsers: new Set(locationRows.map((r: any) => r.user_id).filter(Boolean)).size,
      approved, blocked, unresolved: locationRows.length - approved - blocked, byTrigger },
    identity: { verified: metrics.onboarding.idAccepted, verifiedUsers: metrics.onboarding.idVerifiedUsers,
      rejected: metrics.onboarding.idRejected, review: metrics.onboarding.idReview, failed: metrics.onboarding.idFailed },
    banks: { connected: metrics.onboarding.banksConnected, verified: metrics.onboarding.banksVerified },
    funding: { depositingPlayers: new Set(depositLegs.map((r: any) => r.user_id).filter(Boolean)).size,
      depositEvents: metrics.internal.deposits, depositVolume: metrics.internal.depositVolume,
      depositReturns: metrics.internal.depositReturns, depositsReleased: metrics.internal.depositsReleased,
      withdrawalCount: metrics.internal.withdrawalCount, withdrawalVolume: metrics.internal.withdrawalVolume,
      failedTransfers: metrics.internal.failedTransfers },
    matches: { created: metrics.internal.matchesHosted, accepted: metrics.internal.matchesAccepted, completed: metrics.internal.matchesCompleted,
      uniquePlayers: new Set([...created.map((r: any) => r.player1_id), ...accepted.map((r: any) => r.player2_id)].filter(Boolean)).size,
      avgEntryAmountCreated: metrics.internal.avgWager, totalWagerVolume: metrics.internal.totalWagerVolume,
      breakdown: [...breakdown.values()].sort((a, b) => a.entryAmount - b.entryAmount) },
    platformRevenue: metrics.internal.platformRevenue,
  };
}
async function collect(svc: any, config: any, previous: any, now: number) {
  const checks: any[] = [], since = new Date(now - 86400000).toISOString();
  async function read(key: string, label: string, work: () => Promise<any>, derive: (rows: any[]) => any) {
    try { checks.push(derive(await deadline(work()))); }
    catch { checks.push(check(key, label, 'unknown', 'The bounded read failed or timed out. No healthy result can be inferred.')); }
  }
  const jobs = [
    async () => {
      const enabled = Deno.env.get('MAXMIND_GEOIP_ENABLED') === 'true';
      const accountConfigured = !!String(Deno.env.get('MAXMIND_ACCOUNT_ID') || '').trim();
      const licenseConfigured = !!String(Deno.env.get('MAXMIND_LICENSE_KEY') || '').trim();
      const ready = enabled && accountConfigured && licenseConfigured;
      checks.push(check(
        'maxmind_geoip',
        'MaxMind geolocation enforcement',
        ready ? 'healthy' : 'critical',
        ready
          ? 'Production geolocation enforcement and MaxMind credentials are configured. Provider requests are made only at protected user-action boundaries.'
          : 'Production geolocation is not fully configured. Paid location-gated activity must remain fail-closed until MAXMIND_GEOIP_ENABLED and both MaxMind credentials are present.'
      ));
    },
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
    async () => read('seamless_bank_failures', 'Seamless bank-verification failures', () => svc.SeamlessBankAccount.filter({ status: { $in: ['verification_failed', 'verification_expired', 'error'] }, updated_date: { $gte: since } }, '-updated_date', 501), rows =>
      check('seamless_bank_failures', 'Seamless bank-verification failures', rows.length ? 'warning' : 'healthy',
        rows.length + ' bank-verification failures or expirations updated in the last 24 hours. Monitoring reads saved webhook state only.', rows.length, 'failures')),
    async () => read('seamless_bank_pending', 'Seamless pending bank verifications', () => svc.SeamlessBankAccount.filter({ status: { $in: ['added', 'pending_verification'] } }, '-updated_date', 501), rows => {
      const overdue = rows.filter(r => now - timeMs(r.updated_date || r.added_at) > 60 * 60000).length;
      return check('seamless_bank_pending', 'Seamless pending bank verifications', overdue || rows.length >= 501 ? 'warning' : 'healthy',
        overdue + ' saved bank records have remained pending for over one hour. This is a reconciliation signal, not proof of provider downtime.', overdue, 'accounts');
    }),
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
    config.external_monitor_status === 'configured' ? 'Independent monitoring was configured. This records setup, not its latest probe result; check DigitalOcean for current external observations.' : 'Independent alert delivery is not yet verified. Check the DigitalOcean website monitor; a Base44 outage can also stop this collector. No independent collector-heartbeat alert is configured.'));
  return checks.sort((a, b) => a.key.localeCompare(b.key));
}
Deno.serve(async (req) => {
  let ownsRun = false;
  let stage = 'authenticate';
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
    stage = 'read_config_and_snapshot';
    const [configs, snapshots] = await Promise.all([
      svc.SiteHealthConfig.filter({ key: 'current' }, '-updated_date', 1),
      svc.SiteHealthSnapshot.filter({ key: 'current' }, '-checked_at', 1),
    ]);
    const config = configs[0], previous = snapshots[0];
    if (!config?.enabled) return Response.json({ skipped: true, reason: 'monitoring_disabled' });
    const now = Date.now();
    if (persist && previous && now - timeMs(previous.checked_at) < 12 * 60000)
      return Response.json({ skipped: true, reason: 'minimum_collection_interval' });
    stage = 'collect_checks';
    const checks = await collect(svc, config, previous, now);
    stage = 'build_snapshot';
    const status = overall(checks), checkedAt = new Date().toISOString();
    if (!persist) return Response.json({ status, checked_at: checkedAt, checks, persisted: false, email_sent: false });
    const history = boundedHealthHistory(parseJson(previous?.history_json, []),
      { at: checkedAt, status, values: Object.fromEntries(checks.map(c => [c.key, { status: c.status, value: c.value, latency_ms: c.latency_ms }])) });
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
    stage = 'save_snapshot';
    let saved = previous ? await svc.SiteHealthSnapshot.update(previous.id, payload) : await svc.SiteHealthSnapshot.create(payload);
    let emailAccepted = false;
    if (send) {
      stage = 'format_email';
      const email = formatHealthEmail(checks, checkedAt, digest, notification.recovered);
      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: 'hello@worldchessbet.com',
          subject: email.subject,
          body: email.body,
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
  } catch (error: any) {
    // Classify locally; never log raw SDK errors, response bodies or credentials.
    const detail = String(error?.message || '') + JSON.stringify(error?.response?.data || error?.data || {});
    const reason = /20000|20,000/.test(detail) ? 'field_limit_20000' :
      /too long|max.?length|string_too_long/i.test(detail) ? 'field_length_limit' :
      /validation|validate/i.test(detail) ? 'validation_failed' :
      /rate.?limit|429/i.test(detail) ? 'rate_limited' :
      /unauthorized|forbidden|401|403/i.test(detail) ? 'access_denied' :
      /timeout|timed out/i.test(detail) ? 'timeout' : 'unexpected_error';
    const diagnostic = { event: 'site_health_collection_failed', stage, reason };
    console.error(JSON.stringify(diagnostic));
    return Response.json({ error: 'Health collection failed. Check the reported stage; previous observations may be stale.', stage, reason }, { status: 503 });
  } finally { if (ownsRun) running = false; }
});
