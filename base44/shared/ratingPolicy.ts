import { REPORT_WINDOW_MS } from './reportWindow.ts';

export const RATING_TIME_CONTROLS = ['blitz', 'rapid', 'classical'] as const;

function timestampMs(value: unknown) {
  if (!value) return NaN;
  const text = String(value);
  const normalized = /Z$|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`;
  return new Date(normalized).getTime();
}

export async function loadRatingConfig(base44: any) {
  const rows = await base44.asServiceRole.entities.RatingSystemConfig.filter({ config_key: 'primary' });
  return rows[0] || null;
}

export function ratingDefaults(config: any) {
  return {
    rating: Number(config?.initial_rating) || 1500,
    ratingDeviation: Number(config?.initial_rating_deviation) || 350,
    volatility: Number(config?.initial_volatility) || 0.06,
    tau: Number(config?.tau) || 0.5,
    provisionalGames: Math.max(1, Number(config?.provisional_games) || 10),
    algorithmVersion: String(config?.algorithm_version || 'glicko2_sequential_v1'),
    generation: Math.max(0, Number(config?.current_generation) || 0),
  };
}

export function ratingEligibleAt(contestRecord: any) {
  const settledAtMs = timestampMs(contestRecord?.settlement_timestamp);
  if (!Number.isFinite(settledAtMs)) return '';
  return new Date(settledAtMs + REPORT_WINDOW_MS).toISOString();
}

export async function evaluateContestRatingEligibility(base44: any, contestRecord: any, config: any) {
  if (!contestRecord?.id || !contestRecord.match_id || !contestRecord.game_id) {
    return { eligible: false, permanent: true, reason: 'rating_source_incomplete' };
  }
  if (!RATING_TIME_CONTROLS.includes(contestRecord.time_control)) {
    return { eligible: false, permanent: true, reason: 'unsupported_time_control' };
  }
  if (!contestRecord.white_player_id || !contestRecord.black_player_id || contestRecord.white_player_id === contestRecord.black_player_id) {
    return { eligible: false, permanent: true, reason: 'invalid_participants' };
  }

  const settledAtMs = timestampMs(contestRecord.settlement_timestamp);
  const historyStartMs = timestampMs(config?.history_start_at);
  if (!Number.isFinite(settledAtMs) || !Number.isFinite(historyStartMs)) {
    return { eligible: false, permanent: true, reason: 'invalid_rating_timestamps' };
  }
  if (settledAtMs < historyStartMs) {
    return { eligible: false, permanent: true, reason: 'before_rating_epoch' };
  }
  if (Date.now() < settledAtMs + REPORT_WINDOW_MS) {
    return {
      eligible: false,
      permanent: false,
      reason: 'report_window_open',
      eligibleAt: new Date(settledAtMs + REPORT_WINDOW_MS).toISOString(),
    };
  }

  const [match, game, cases, flags, payouts] = await Promise.all([
    base44.asServiceRole.entities.Match.get(contestRecord.match_id).catch(() => null),
    base44.asServiceRole.entities.Game.get(contestRecord.game_id).catch(() => null),
    base44.asServiceRole.entities.DisputeCase.filter({ match_id: contestRecord.match_id }),
    base44.asServiceRole.entities.IntegrityFlag.filter({ match_id: contestRecord.match_id }),
    base44.asServiceRole.entities.WalletTransaction.filter({ match_id: contestRecord.match_id, type: 'payout' }),
  ]);

  if (!match || !game || game.match_id !== match.id) {
    return { eligible: false, permanent: true, reason: 'authoritative_contest_missing' };
  }
  if (match.status !== 'completed' || game.status !== 'completed' || match.result === 'cancelled') {
    return { eligible: false, permanent: match.status === 'cancelled', reason: 'contest_not_final' };
  }
  if (match.player1_id !== contestRecord.white_player_id || match.player2_id !== contestRecord.black_player_id) {
    return { eligible: false, permanent: true, reason: 'participant_snapshot_mismatch' };
  }

  const invalidatingCase = cases.find((c: any) =>
    c.status === 'resolved' && ['contest_reversed', 'contest_voided'].includes(c.resolution_type)
  );
  if (invalidatingCase) {
    return { eligible: false, permanent: true, reason: invalidatingCase.resolution_type };
  }
  if (cases.some((c: any) => !['resolved', 'closed'].includes(c.status))) {
    return { eligible: false, permanent: false, reason: 'dispute_open' };
  }

  // Safety-first: any unresolved match-linked integrity review delays rating.
  // This is stricter than payout release. Ratings are non-critical and can
  // safely wait until the review is cleared; the contest record remains the
  // durable backlog so no game is lost.
  if (flags.some((f: any) => ['open', 'under_review'].includes(f.status))) {
    return { eligible: false, permanent: false, reason: 'integrity_review_open' };
  }

  const isDraw = !contestRecord.winner_id;
  if (!isDraw) {
    if (![contestRecord.white_player_id, contestRecord.black_player_id].includes(contestRecord.winner_id)) {
      return { eligible: false, permanent: true, reason: 'invalid_winner' };
    }
    const payout = payouts.find((p: any) => p.status === 'completed');
    if (!payout) return { eligible: false, permanent: false, reason: 'payout_not_confirmed' };
    if (payout.payout_hold_status === 'consumed' || payout.payout_hold_status === 'void') {
      return { eligible: false, permanent: true, reason: 'payout_invalidated' };
    }
    if (payout.payout_hold_status !== 'released') {
      return { eligible: false, permanent: false, reason: 'payout_not_final' };
    }
  }

  return {
    eligible: true,
    permanent: false,
    reason: 'eligible',
    match,
    game,
    isDraw,
    eligibleAt: new Date(settledAtMs + REPORT_WINDOW_MS).toISOString(),
  };
}
