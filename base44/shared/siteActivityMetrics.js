// Read-only Site Activity calculations. Money comes from complete immutable
// journal batches; transaction rows describe requests and current pipeline state.
export const PRODUCTION_START = '2026-09-09T22:59:21.815Z';
const DAY = 86400000;
export const ms = value => {
  if (!value) return NaN;
  // Base44 may return UTC timestamps without a zone.
  const text = String(value);
  return Date.parse(/T/.test(text) && !/Z$|[+-]\d\d:\d\d$/.test(text) ? text + 'Z' : text);
};
const money = value => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) throw new Error('Invalid monetary value in reporting source');
  return Math.round(n * 100);
};
const sumMoney = (rows, field) => rows.reduce((sum, row) => sum + money(row[field]), 0) / 100;
const ids = (rows, field = 'user_id') => new Set(rows.map(row => row[field]).filter(Boolean));
export const inRange = (value, start, end) => ms(value) >= +start && ms(value) <= +end;
export const dayKey = value => Number.isFinite(ms(value)) ? new Date(ms(value)).toISOString().slice(0, 10) : null;
export function computeRange(body = {}, now = new Date()) {
  const preset = body.preset || '7d';
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let start, end;
  if (preset === 'custom') {
    const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (!valid(body.startDate) || !valid(body.endDate)) throw new Error('Choose valid start and end dates.');
    start = new Date(body.startDate + 'T00:00:00Z');
    end = new Date(body.endDate + 'T23:59:59.999Z');
    if (+start > +end) throw new Error('Start date must be on or before end date.');
    if ((+end - +start + 1) / DAY > 92) throw new Error('Choose a range of 92 days or less.');
  } else {
    const lengths = { today: 1, yesterday: 1, '7d': 7, '30d': 30, '90d': 90 };
    if (!lengths[preset]) throw new Error('Unknown date range.');
    start = new Date(today - (preset === 'yesterday' ? 1 : lengths[preset] - 1) * DAY);
    end = preset === 'yesterday' ? new Date(today - 1) : now;
  }
  const gaStart = dayKey(start.toISOString()), gaEnd = dayKey(end.toISOString());
  const dayKeys = [];
  for (let day = +start; day <= +end; day += DAY) dayKeys.push(new Date(day).toISOString().slice(0, 10));
  return { preset, start, end, gaStart, gaEnd, dayKeys };
}

// A failed or repeating page aborts the report rather than returning false totals.
export async function readAll(entity, query = {}, fields) {
  const rows = [], seen = new Set();
  for (let skip = 0; ; skip += 500) {
    const page = await entity.filter(query, 'created_date', 500, skip, fields);
    if (!Array.isArray(page)) throw new Error('Invalid reporting source response');
    for (const row of page) {
      if (!row.id || seen.has(row.id)) throw new Error('Reporting source changed during pagination. Refresh to retry.');
      seen.add(row.id); rows.push(row);
    }
    if (page.length < 500) return rows;
  }
}
const production = row => Number(row.launch_epoch) === 2 && ms(row.created_date || row.created_at) >= ms(PRODUCTION_START) &&
  !/^(prelaunch_|legacy_|early_access)/.test(row.source_event || row.trigger_event || '');

export function journalLegs(batches) {
  const groups = new Map(), legs = [];
  for (const batch of batches.filter(production)) {
    const previous = groups.get(batch.ledger_group_id);
    if (previous) {
      if (previous !== batch.legs_json) throw new Error('Conflicting journal batches; inspect the transaction ledger.');
      continue;
    }
    if (!batch.ledger_group_id) throw new Error('Journal is missing a group identifier.');
    const parsed = JSON.parse(batch.legs_json);
    if (!Array.isArray(parsed) || parsed.length !== batch.leg_count ||
      money(batch.total_debit) !== money(batch.total_credit) ||
      sumMoney(parsed, 'debit_amount') !== money(batch.total_debit) / 100 ||
      sumMoney(parsed, 'credit_amount') !== money(batch.total_credit) / 100) {
      throw new Error('Incomplete or unbalanced journal; inspect the transaction ledger.');
    }
    groups.set(batch.ledger_group_id, batch.legs_json);
    for (const leg of parsed) legs.push({ ...leg, occurred_at: batch.created_at || batch.created_date,
      wallet_transaction_id: leg.wallet_transaction_id || batch.wallet_transaction_id,
      ledger_group_id: batch.ledger_group_id });
  }
  return legs;
}

export function buildActivityMetrics(sources, range, isWalletLocationEvidence, now = new Date()) {
  const { start, end, dayKeys } = range;
  const within = value => inRange(value, start, end);
  const txs = sources.transactions.filter(production);
  const matches = sources.matches.filter(production);
  const legs = journalLegs(sources.journals);
  const periodLegs = legs.filter(row => within(row.occurred_at));
  const userLegs = periodLegs.filter(row => row.ledger_account === 'user_account');
  const depositLegs = userLegs.filter(row => money(row.total_deposited_delta) > 0);
  const returnedLegs = userLegs.filter(row => money(row.total_deposited_delta) < 0);
  const withdrawalLegs = userLegs.filter(row => money(row.total_withdrawn_delta) > 0);
  const revenueLegs = periodLegs.filter(row => row.ledger_account === 'platform_revenue');
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const netRevenue = rows => (rows.reduce((sum, row) => sum + money(row.credit_amount) - money(row.debit_amount), 0)) / 100;
  const hosted = matches.filter(row => within(row.created_date));
  const accepted = matches.filter(row => within(row.preparation_started_at));
  const completed = matches.filter(row => row.status === 'completed' && within(row.completed_at));
  const registrations = sources.users.filter(row => within(row.created_date));
  const regIds = ids(registrations, 'id'), depositIds = ids(depositLegs);
  const newDepositors = [...depositIds].filter(id => regIds.has(id)).length;
  const pending = type => txs.filter(row => row.type === type && (
    ['pending','processing','review_required'].includes(row.status) ||
    ['submitted','submitting','uncertain'].includes(row.integration_status)
  ) && !['completed','failed','reversed'].includes(row.status));
  const heldDeposits = txs.filter(row => row.type === 'deposit' && row.status === 'completed' && row.deposit_hold_status === 'held');
  const waitTimes = accepted.map(row => (ms(row.preparation_started_at) - ms(row.created_date)) / 1000).filter(n => Number.isFinite(n) && n >= 0);
  const revenueToday = legs.filter(row => row.ledger_account === 'platform_revenue' && inRange(row.occurred_at, today, now));
  const earnings = userLegs.filter(row => money(row.total_wagered_delta) > 0);
  const releaseLegs = userLegs.filter(row => row.trigger_event === 'deposit_availability_release');
  const distinctEvents = rows => ids(rows, 'ledger_group_id').size;
  const txRequests = txs.filter(row => within(row.created_date));
  const internal = {
    registrations: registrations.length,
    deposits: distinctEvents(depositLegs), depositVolume: sumMoney(depositLegs, 'total_deposited_delta'),
    depositReturns: -sumMoney(returnedLegs, 'total_deposited_delta'),
    depositsReleased: sumMoney(releaseLegs, 'available_delta'),
    depositConversion: registrations.length ? Math.round(newDepositors / registrations.length * 1000) / 10 : null,
    withdrawalCount: distinctEvents(withdrawalLegs), withdrawalVolume: sumMoney(withdrawalLegs, 'total_withdrawn_delta'),
    pendingDeposits: pending('deposit').length, pendingDepositVolume: sumMoney(pending('deposit'), 'amount'),
    heldDeposits: heldDeposits.length, heldDepositVolume: sumMoney(heldDeposits, 'amount'),
    pendingWithdrawals: pending('withdrawal').length, pendingWithdrawalVolume: sumMoney(pending('withdrawal'), 'amount'),
    failedTransfers: txRequests.filter(row => ['deposit','withdrawal'].includes(row.type) && row.status === 'failed').length,
    reviewTransfers: txs.filter(row => ['deposit','withdrawal'].includes(row.type) && (row.status === 'review_required' || row.integration_status === 'uncertain')).length,
    availableBalance: sumMoney(sources.wallets, 'available_balance'), heldBalance: sumMoney(sources.wallets, 'held_balance'),
    matchesHosted: hosted.length, matchesAccepted: accepted.length,
    matchesDeclined: sources.declines.filter(row => within(row.created_date) && matches.some(m => m.id === row.match_id)).length,
    matchesCompleted: completed.length, activeGames: matches.filter(row => row.status === 'in_progress').length,
    avgWager: hosted.length ? Math.round(sumMoney(hosted, 'wager_amount') / hosted.length * 100) / 100 : 0,
    totalWagerVolume: sumMoney(earnings, 'total_wagered_delta'),
    platformRevenue: netRevenue(revenueLegs), platformRevenueToday: netRevenue(revenueToday),
    feeCredits: sumMoney(revenueLegs, 'credit_amount'), feeRefunds: sumMoney(revenueLegs, 'debit_amount'),
    avgMatchWaitSeconds: waitTimes.length ? Math.round(waitTimes.reduce((sum,n) => sum+n,0) / waitTimes.length) : 0,
  };

  const locationEvents = sources.locations.filter(row => row.trigger_event === 'wallet_onboarding' && within(row.verified_at));
  const locAccepted = locationEvents.filter(row => isWalletLocationEvidence(row, row.user_id));
  const locRejected = locationEvents.filter(row => row.verification_result === 'blocked' && row.enforcement_bypassed !== true && row.geolocation_enforcement_enabled === true);
  const firstLocation = new Map();
  for (const row of sources.locations.filter(row => isWalletLocationEvidence(row, row.user_id))) {
    if (!firstLocation.has(row.user_id) || ms(row.verified_at) < ms(firstLocation.get(row.user_id).verified_at)) firstLocation.set(row.user_id, row);
  }
  const productionIds = sources.identities.filter(row => row.environment === 'production');
  const completedIds = productionIds.filter(row => within(row.completed_at));
  const acceptedIds = completedIds.filter(row => row.status === 'verified');
  const rejectedIds = completedIds.filter(row => row.status === 'rejected');
  // An expired session is not a rejected ID. Pending counts describe current state.
  const currentPendingIds = productionIds.filter(row => row.status === 'pending' && (!row.expires_at || ms(row.expires_at) > +now));
  const banks = new Map();
  for (const row of [...sources.banks].sort((a,b) => ms(a.updated_date || a.created_date) - ms(b.updated_date || b.created_date))) {
    if (row.source_id && row.user_id) banks.set(row.user_id + ':' + row.source_id, row);
  }
  const allBanks = [...banks.values()];
  const newBanks = allBanks.filter(row => within(row.added_at || row.created_date));
  const verifiedBanks = allBanks.filter(row => row.status === 'verified');
  const bankVerifiedPeriod = allBanks.filter(row => row.verified_at && within(row.verified_at));
  const onboarding = {
    locationAccepted: locAccepted.length, locationRejected: locRejected.length,
    locationUnresolved: locationEvents.length - locAccepted.length - locRejected.length,
    locationCompletedUsers: [...firstLocation.values()].filter(row => within(row.verified_at)).length,
    locationApprovedUsersNow: firstLocation.size,
    idAccepted: acceptedIds.length, idRejected: rejectedIds.length,
    idReview: completedIds.filter(row => row.status === 'review_required').length,
    idFailed: completedIds.filter(row => row.status === 'failed').length,
    idVerifiedUsers: ids(acceptedIds).size,
    idPendingNow: currentPendingIds.length,
    idExpiredRequests: productionIds.filter(row => within(row.requested_at) && (row.status === 'expired' || (row.status === 'pending' && ms(row.expires_at) <= +now))).length,
    banksConnected: newBanks.length, banksVerified: bankVerifiedPeriod.length,
    banksConnectedNow: allBanks.filter(row => ['added','pending_verification','verified'].includes(row.status)).length,
    banksVerifiedNow: verifiedBanks.length, bankUsersNow: ids(verifiedBanks).size,
  };
  internal.verifiedUsers = onboarding.idVerifiedUsers;
  const matchPlayers = ids([...hosted.map(row => ({user_id:row.player1_id})), ...accepted.map(row => ({user_id:row.player2_id}))]);
  const completedPlayers = ids(completed.flatMap(row => [{user_id:row.player1_id},{user_id:row.player2_id}]));
  // Independent activity counts, not an invented sequential funnel across different cohorts.
  const funnel = [
    {step:'New registrations',count:registrations.length},
    {step:'Wallet location completed',count:onboarding.locationCompletedUsers},
    {step:'ID approved',count:onboarding.idVerifiedUsers},
    {step:'Bank verified',count:ids(bankVerifiedPeriod).size},
    {step:'Deposit received',count:depositIds.size},
    {step:'Hosted or joined a challenge',count:matchPlayers.size},
    {step:'Completed a match',count:completedPlayers.size},
  ];
  const charts = dayKeys.map(day => {
    const daily = periodLegs.filter(row => dayKey(row.occurred_at) === day);
    const dailyHosted = hosted.filter(row => dayKey(row.created_date) === day);
    return {date:day,traffic:null,registrations:registrations.filter(row => dayKey(row.created_date) === day).length,
      deposits:sumMoney(daily.filter(row => row.ledger_account === 'user_account' && money(row.total_deposited_delta)>0),'total_deposited_delta'),
      matches:dailyHosted.length,revenue:netRevenue(daily.filter(row => row.ledger_account === 'platform_revenue')),
      avgWager:dailyHosted.length ? Math.round(sumMoney(dailyHosted,'wager_amount') / dailyHosted.length * 100) / 100 : 0};
  });
  return {internal,onboarding,funnel,charts};
}
