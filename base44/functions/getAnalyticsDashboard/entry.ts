import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Restricted to the same admin account as the rest of the Site Activity /
// Analytics dashboard.
const ALLOWED_ADMIN_EMAIL = 'jordangust96@gmail.com';
const GA_API_BASE = 'https://analyticsdata.googleapis.com/v1beta';
const FETCH_LIMIT = 5000;
const MAX_DAYS = 92;

function computeRange(body) {
  const preset = body?.preset || '7d';
  const now = new Date();
  let gaStart, gaEnd, start, end;
  if (preset === 'today') {
    gaStart = 'today'; gaEnd = 'today';
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    end = now;
  } else if (preset === 'yesterday') {
    gaStart = 'yesterday'; gaEnd = 'yesterday';
    const y = new Date(now); y.setUTCDate(y.getUTCDate() - 1);
    start = new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate()));
    end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  } else if (preset === '30d') {
    gaStart = '30daysAgo'; gaEnd = 'today';
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    end = now;
  } else if (preset === '90d') {
    gaStart = '90daysAgo'; gaEnd = 'today';
    start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    end = now;
  } else if (preset === 'custom' && body?.startDate && body?.endDate) {
    gaStart = body.startDate; gaEnd = body.endDate;
    start = new Date(`${body.startDate}T00:00:00Z`);
    end = new Date(`${body.endDate}T23:59:59Z`);
  } else {
    gaStart = '7daysAgo'; gaEnd = 'today';
    start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    end = now;
  }
  return { preset, gaStart, gaEnd, start, end };
}

function buildDayKeys(start, end) {
  const keys = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  let guard = 0;
  while (cursor <= last && guard < MAX_DAYS) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard++;
  }
  return keys;
}

function dayKey(dateStr) {
  return new Date(dateStr).toISOString().slice(0, 10);
}

function inRange(dateStr, start, end) {
  if (!dateStr) return false;
  const t = new Date(dateStr).getTime();
  return t >= start.getTime() && t <= end.getTime();
}

async function getConnectedAccountEmail(accessToken) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.email || null;
  } catch {
    return null;
  }
}

async function runGA4Batch(accessToken, propertyId, requests) {
  const res = await fetch(`${GA_API_BASE}/properties/${propertyId}:batchRunReports`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });
  const data = await res.json();
  if (!res.ok) {
    const message = data?.error?.message || `GA4 API error (${res.status})`;
    throw new Error(message);
  }
  return data.reports || [];
}

function metricVal(row, index) {
  const raw = row?.metricValues?.[index]?.value;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function dimVal(row, index) {
  return row?.dimensionValues?.[index]?.value || '(not set)';
}

function bucketSourceMedium(sourceMedium) {
  const s = (sourceMedium || '').toLowerCase();
  const [source = '', medium = ''] = s.split(' / ');
  if (source.includes('reddit')) return 'Reddit';
  if (source.includes('tiktok')) return 'TikTok';
  if (source.includes('facebook') || source.includes('fb')) return 'Facebook';
  if (source === 'x' || source.includes('twitter') || source.includes('x.com')) return 'X';
  if ((medium.includes('cpc') || medium.includes('ppc') || medium.includes('paid')) && source.includes('google')) return 'Google Ads';
  if (source === '(direct)' && medium === '(none)') return 'Direct';
  if (medium === 'organic') return 'Organic Search';
  if (medium === 'referral') return 'Referral';
  return 'Other';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin' || user.email !== ALLOWED_ADMIN_EMAIL) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { preset, gaStart, gaEnd, start, end } = computeRange(body);
    const dayKeys = buildDayKeys(start, end);

    // ---------- GA4 ----------
    const connector = { connected: false, accountEmail: null, propertyId: null, error: null };
    let ga4 = null;
    const propertyId = Deno.env.get('GA4_PROPERTY_ID');
    connector.propertyId = propertyId || null;

    if (!propertyId) {
      connector.error = 'GA4 property ID is not configured. Set the GA4_PROPERTY_ID secret to your GA4 property\'s numeric ID (Admin \u2192 Property Settings in Google Analytics).';
    } else {
      let accessToken = null;
      try {
        const connection = await base44.asServiceRole.connectors.getConnection('google_analytics');
        accessToken = connection.accessToken;
        connector.connected = true;
      } catch {
        connector.error = 'Google Analytics is not connected. Reconnect the Google Analytics connector for this app.';
      }

      if (accessToken) {
        connector.accountEmail = await getConnectedAccountEmail(accessToken);
        try {
          const dateRanges = [{ startDate: gaStart, endDate: gaEnd }];
          const batchA = await runGA4Batch(accessToken, propertyId, [
            { dateRanges, metrics: [{ name: 'totalUsers' }, { name: 'newUsers' }, { name: 'sessions' }, { name: 'engagedSessions' }, { name: 'averageSessionDuration' }, { name: 'bounceRate' }, { name: 'screenPageViews' }, { name: 'activeUsers' }] },
            { dateRanges, dimensions: [{ name: 'date' }], metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' }], orderBys: [{ dimension: { dimensionName: 'date' } }] },
            { dateRanges, dimensions: [{ name: 'sessionSourceMedium' }], metrics: [{ name: 'sessions' }], limit: 50, orderBys: [{ metric: { metricName: 'sessions' }, desc: true }] },
            { dateRanges, dimensions: [{ name: 'deviceCategory' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }] },
            { dateRanges, dimensions: [{ name: 'country' }], metrics: [{ name: 'activeUsers' }], limit: 10, orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }] },
          ]);

          const overviewRow = batchA[0]?.rows?.[0];
          const totalUsers = metricVal(overviewRow, 0);
          const newUsers = metricVal(overviewRow, 1);
          const overview = {
            totalUsers,
            activeUsers: metricVal(overviewRow, 7),
            newUsers,
            sessions: metricVal(overviewRow, 2),
            engagedSessions: metricVal(overviewRow, 3),
            avgEngagementTimeSeconds: Math.round(metricVal(overviewRow, 4)),
            bounceRate: Math.round(metricVal(overviewRow, 5) * 1000) / 10,
            views: metricVal(overviewRow, 6),
            uniqueVisitors: totalUsers,
            returningVisitors: Math.max(0, totalUsers - newUsers),
          };

          const trafficSeries = (batchA[1]?.rows || []).map((row) => {
            const raw = dimVal(row, 0);
            const formatted = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
            return { date: formatted, sessions: metricVal(row, 0), totalUsers: metricVal(row, 1), views: metricVal(row, 2) };
          });

          const acquisitionBuckets = {};
          for (const row of batchA[2]?.rows || []) {
            const bucket = bucketSourceMedium(dimVal(row, 0));
            acquisitionBuckets[bucket] = (acquisitionBuckets[bucket] || 0) + metricVal(row, 0);
          }
          const acquisitionRaw = (batchA[2]?.rows || []).slice(0, 15).map((row) => ({ sourceMedium: dimVal(row, 0), sessions: metricVal(row, 0) }));

          const devices = (batchA[3]?.rows || []).map((row) => ({ category: dimVal(row, 0), sessions: metricVal(row, 0) }));
          const countries = (batchA[4]?.rows || []).map((row) => ({ name: dimVal(row, 0), activeUsers: metricVal(row, 0) }));

          let states = [];
          let cities = [];
          let landingPages = [];
          let exitPages = [];
          let avgTimePerPage = [];
          try {
            const batchB = await runGA4Batch(accessToken, propertyId, [
              { dateRanges, dimensions: [{ name: 'region' }], metrics: [{ name: 'activeUsers' }], limit: 10, orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }] },
              { dateRanges, dimensions: [{ name: 'city' }], metrics: [{ name: 'activeUsers' }], limit: 10, orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }] },
              { dateRanges, dimensions: [{ name: 'landingPage' }], metrics: [{ name: 'sessions' }], limit: 10, orderBys: [{ metric: { metricName: 'sessions' }, desc: true }] },
              // GA4's Data API has no true "exits" metric — screenPageViews is the
              // closest supported proxy for identifying high-traffic exit candidates.
              { dateRanges, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }], limit: 10, orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }] },
              { dateRanges, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'userEngagementDuration' }, { name: 'screenPageViews' }], limit: 10, orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }] },
            ]);
            states = (batchB[0]?.rows || []).map((row) => ({ name: dimVal(row, 0), activeUsers: metricVal(row, 0) }));
            cities = (batchB[1]?.rows || []).map((row) => ({ name: dimVal(row, 0), activeUsers: metricVal(row, 0) }));
            landingPages = (batchB[2]?.rows || []).map((row) => ({ path: dimVal(row, 0), sessions: metricVal(row, 0) }));
            exitPages = (batchB[3]?.rows || []).map((row) => ({ path: dimVal(row, 0), views: metricVal(row, 0) }));
            avgTimePerPage = (batchB[4]?.rows || []).map((row) => {
              const views = metricVal(row, 1);
              const duration = metricVal(row, 0);
              return { path: dimVal(row, 0), avgSeconds: views > 0 ? Math.round(duration / views) : 0 };
            });
          } catch (batchBError) {
            connector.error = `Geography and Pages data could not be loaded: ${batchBError.message}`;
          }

          ga4 = {
            overview,
            trafficSeries,
            acquisition: { buckets: acquisitionBuckets, raw: acquisitionRaw },
            devices,
            geography: { countries, states, cities },
            pages: { landingPages, exitPages, avgTimePerPage },
          };
        } catch (gaError) {
          const msg = gaError.message || '';
          if (msg.includes('403') || msg.toLowerCase().includes('permission')) {
            connector.error = `The connected Google account does not have access to this GA4 property. Grant it Viewer access in GA4 Admin \u2192 Property Access Management. (${msg})`;
          } else if (msg.includes('400') || msg.toLowerCase().includes('invalid')) {
            connector.error = `The configured GA4 property ID (${propertyId}) appears to be invalid, or the Google Analytics Data API is not enabled. (${msg})`;
          } else {
            connector.error = `Failed to load GA4 data: ${msg}`;
          }
        }
      }
    }

    // ---------- Internal metrics ----------
    const [users, matches, walletTxs, ledgerEntries, declines] = await Promise.all([
      base44.asServiceRole.entities.User.list('-created_date', FETCH_LIMIT),
      base44.asServiceRole.entities.Match.list('-created_date', FETCH_LIMIT),
      base44.asServiceRole.entities.WalletTransaction.list('-created_date', FETCH_LIMIT),
      base44.asServiceRole.entities.LedgerEntry.list('-created_date', FETCH_LIMIT),
      base44.asServiceRole.entities.MatchDeclineLog.list('-created_date', FETCH_LIMIT),
    ]);

    const registrations = users.filter((u) => inRange(u.created_date, start, end));
    const verifiedUsers = users.filter((u) => inRange(u.identity_verified_at, start, end));
    const deposits = walletTxs.filter((t) => t.type === 'deposit' && t.status === 'completed' && inRange(t.created_date, start, end));
    const depositUserIds = new Set(deposits.map((d) => d.user_id));
    const depositVolume = deposits.reduce((s, d) => s + (d.amount || 0), 0);

    const matchesHosted = matches.filter((m) => inRange(m.created_date, start, end));
    const matchesAccepted = matches.filter((m) => inRange(m.preparation_started_at, start, end));
    const matchesDeclined = declines.filter((d) => inRange(d.created_date, start, end));
    const matchesCompleted = matches.filter((m) => m.status === 'completed' && inRange(m.completed_at, start, end));
    const activeGames = matches.filter((m) => m.status === 'in_progress').length;
    const avgWager = matchesHosted.length > 0 ? matchesHosted.reduce((s, m) => s + (m.wager_amount || 0), 0) / matchesHosted.length : 0;
    const totalWagerVolume = matchesHosted.reduce((s, m) => s + (m.wager_amount || 0), 0);
    const platformRevenue = ledgerEntries
      .filter((l) => l.ledger_account === 'platform_revenue' && l.transaction_type === 'platform_fee' && inRange(l.created_date, start, end))
      .reduce((s, l) => s + (l.credit_amount || 0), 0);
    const waitTimes = matchesAccepted
      .filter((m) => m.created_date && m.preparation_started_at)
      .map((m) => (new Date(m.preparation_started_at).getTime() - new Date(m.created_date).getTime()) / 1000);
    const avgMatchWaitSeconds = waitTimes.length > 0 ? Math.round(waitTimes.reduce((s, v) => s + v, 0) / waitTimes.length) : 0;

    // Today's platform service fee earned — always the current UTC day,
    // independent of the selected time range filter.
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
    const todaysPlatformFeeEarned = ledgerEntries
      .filter((l) => l.ledger_account === 'platform_revenue' && l.transaction_type === 'platform_fee' && inRange(l.created_date, todayStart, todayEnd))
      .reduce((s, l) => s + (l.credit_amount || 0), 0);

    const internal = {
      registrations: registrations.length,
      verifiedUsers: verifiedUsers.length,
      deposits: deposits.length,
      depositVolume: Math.round(depositVolume * 100) / 100,
      depositConversion: registrations.length > 0 ? Math.round((depositUserIds.size / registrations.length) * 1000) / 10 : 0,
      matchesHosted: matchesHosted.length,
      matchesAccepted: matchesAccepted.length,
      matchesDeclined: matchesDeclined.length,
      matchesCompleted: matchesCompleted.length,
      activeGames,
      avgWager: Math.round(avgWager * 100) / 100,
      totalWagerVolume: Math.round(totalWagerVolume * 100) / 100,
      platformRevenue: Math.round(platformRevenue * 100) / 100,
      todaysPlatformFeeEarned: Math.round(todaysPlatformFeeEarned * 100) / 100,
      avgMatchWaitSeconds,
    };

    // ---------- Funnel ----------
    const hostUserIds = new Set(matchesHosted.map((m) => m.player1_id).filter(Boolean));
    const acceptUserIds = new Set(matchesAccepted.map((m) => m.player2_id).filter(Boolean));
    const completeUserIds = new Set();
    for (const m of matchesCompleted) {
      if (m.player1_id) completeUserIds.add(m.player1_id);
      if (m.player2_id) completeUserIds.add(m.player2_id);
    }
    const funnelSteps = [
      { step: 'Visitors', count: ga4 ? ga4.overview.totalUsers : null },
      { step: 'Registration', count: registrations.length },
      { step: 'Identity Verification', count: verifiedUsers.length },
      { step: 'Deposit', count: depositUserIds.size },
      { step: 'Host Match', count: hostUserIds.size },
      { step: 'Accept Match', count: acceptUserIds.size },
      { step: 'Complete Match', count: completeUserIds.size },
    ];
    const funnel = funnelSteps.map((s, i) => {
      const prev = i > 0 ? funnelSteps[i - 1].count : null;
      const conversionRate = i > 0 && prev ? Math.round((s.count / prev) * 1000) / 10 : null;
      return { ...s, conversionRate };
    });

    // ---------- Daily charts ----------
    const trafficByDay = {};
    for (const row of ga4?.trafficSeries || []) trafficByDay[row.date] = row.sessions;

    const charts = dayKeys.map((day) => {
      const dayMatches = matchesHosted.filter((m) => dayKey(m.created_date) === day);
      const dayDeposits = deposits.filter((d) => dayKey(d.created_date) === day);
      const dayRegs = registrations.filter((u) => dayKey(u.created_date) === day);
      const dayRevenue = ledgerEntries.filter((l) => l.ledger_account === 'platform_revenue' && l.transaction_type === 'platform_fee' && dayKey(l.created_date) === day);
      return {
        date: day,
        traffic: trafficByDay[day] || 0,
        registrations: dayRegs.length,
        deposits: dayDeposits.reduce((s, d) => s + (d.amount || 0), 0),
        matches: dayMatches.length,
        revenue: dayRevenue.reduce((s, l) => s + (l.credit_amount || 0), 0),
        avgWager: dayMatches.length > 0 ? Math.round((dayMatches.reduce((s, m) => s + (m.wager_amount || 0), 0) / dayMatches.length) * 100) / 100 : 0,
      };
    });

    return Response.json({
      range: { preset, startDate: dayKeys[0], endDate: dayKeys[dayKeys.length - 1] },
      connector,
      ga4,
      internal,
      funnel,
      charts,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});