import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { computeRange, readAll, buildActivityMetrics, PRODUCTION_START } from '../../shared/siteActivityMetrics.js';
import { isWalletLocationEvidence } from '../../shared/walletOnboardingLocation.ts';

// Restricted to the same admin account as the rest of the Site Activity /
// Analytics dashboard.
const ALLOWED_ADMIN_EMAIL = 'jordangust96@gmail.com';
const GA_API_BASE = 'https://analyticsdata.googleapis.com/v1beta';
async function getConnectedAccountEmail(accessToken) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
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
    body: JSON.stringify({ requests: requests.map(request => ({ ...request,
      dimensionFilter: { filter: { fieldName: 'hostName', inListFilter: { values: ['worldchessbet.com', 'www.worldchessbet.com'] } } },
    })) }),
    signal: AbortSignal.timeout(15000),
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
  return row?.dimensionValues?.[index]?.value || '(unknown)';
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
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin' || user.email !== ALLOWED_ADMIN_EMAIL) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    let range;
    try { range = computeRange(body); }
    catch (error) { return Response.json({ error: error.message }, { status: 400 }); }
    const { preset, gaStart, gaEnd } = range;

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

          if (batchA.length !== 5) throw new Error('Incomplete GA4 report response');
          connector.timeZone = batchA[0]?.metadata?.timeZone || 'GA4 property timezone';
          connector.dataWarnings = batchA.some(report => report.metadata?.subjectToThresholding || report.metadata?.dataLossFromOtherRow)
            ? ['Google applied reporting thresholds or grouped some data.'] : [];
          const overviewRow = batchA[0]?.rows?.[0];
          const totalUsers = metricVal(overviewRow, 0);
          const newUsers = metricVal(overviewRow, 1);
          const overview = {
            totalUsers,
            activeUsers: metricVal(overviewRow, 7),
            newUsers,
            sessions: metricVal(overviewRow, 2),
            engagedSessions: metricVal(overviewRow, 3),
            avgSessionDurationSeconds: Math.round(metricVal(overviewRow, 4)),
            bounceRate: Math.round(metricVal(overviewRow, 5) * 1000) / 10,
            views: metricVal(overviewRow, 6),
            uniqueVisitors: totalUsers,
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
              // Page views are page views; never label them as exits.
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

    // ---------- Read-only platform sources ----------
    const svc = base44.asServiceRole.entities;
    const sinceProduction = { launch_epoch: 2, created_date: { $gte: PRODUCTION_START } };
    const sourceSpecs = [
      ['users', 'User', {}, ['id','created_date']],
      ['matches', 'Match', sinceProduction, ['id','created_date','launch_epoch','status','wager_amount','preparation_started_at','completed_at','player1_id','player2_id']],
      ['transactions', 'WalletTransaction', sinceProduction, ['id','created_date','launch_epoch','user_id','type','amount','status','integration_status','source_event','deposit_hold_status']],
      ['journals', 'LedgerJournalBatch', sinceProduction, ['id','created_date','created_at','launch_epoch','ledger_group_id','wallet_transaction_id','trigger_event','legs_json','leg_count','total_credit','total_debit']],
      ['declines', 'MatchDeclineLog', { created_date: { $gte: range.start.toISOString(), $lte: range.end.toISOString() } }, ['id','created_date','match_id']],
      ['wallets', 'Wallet', {}, ['id','created_date','available_balance','held_balance']],
      ['locations', 'JurisdictionVerificationLog', {}, ['id','created_date','user_id','provider','verification_result','pre_bypass_verification_result','geolocation_enforcement_enabled','enforcement_bypassed','vpn_or_proxy_detected','ip_address','detected_country','detected_state','trigger_event','verified_at']],
      ['identities', 'SocureIdentityVerification', { environment: 'production' }, ['id','created_date','user_id','status','environment','completed_at','requested_at','expires_at']],
      ['banks', 'SeamlessBankAccount', {}, ['id','created_date','updated_date','user_id','source_id','status','added_at','verified_at']],
    ];
    const sources = {};
    // Bounded concurrency avoids a burst of entity calls; every page must load.
    for (let index = 0; index < sourceSpecs.length; index += 3) {
      await Promise.all(sourceSpecs.slice(index, index + 3).map(async ([key, entity, query, fields]) => {
        try { sources[key] = await readAll(svc[entity], query, fields); }
        catch { throw new Error('Could not load complete ' + entity + ' records. Refresh to retry; totals were not calculated.'); }
      }));
    }
    const metrics = buildActivityMetrics(sources, range, isWalletLocationEvidence);
    const trafficByDay = new Map((ga4?.trafficSeries || []).map(row => [row.date, row.sessions]));
    metrics.charts = metrics.charts.map(row => ({ ...row, traffic: ga4 ? (trafficByDay.get(row.date) ?? 0) : null }));
    return Response.json({
      range: { preset, startDate: gaStart, endDate: gaEnd, timeZone: 'UTC' },
      generatedAt: new Date().toISOString(),
      financialStart: PRODUCTION_START,
      connector, ga4, ...metrics,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});