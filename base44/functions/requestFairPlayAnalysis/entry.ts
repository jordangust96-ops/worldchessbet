import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { requireAdminMfa } from '../../shared/mfa.ts';

// Queues one completed ChessBet game for the external Stockfish analyzer. The
// analyzer is optional during setup; records remain awaiting_analyzer until its
// protected endpoint has been configured. This function never changes outcomes,
// funds, user access, or withdrawal holds.
const VALID_BANDS = ['insufficient_data', 'cleared', 'monitor', 'review'];

function numberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizedSide(value: Record<string, unknown> | undefined) {
  const side = value || {};
  return {
    eligible_moves: numberOrNull(side.eligible_moves) ?? numberOrNull(side.analyzed_moves) ?? 0,
    average_centipawn_loss: numberOrNull(side.average_centipawn_loss),
    median_centipawn_loss: numberOrNull(side.median_centipawn_loss),
    top_1_match_rate: numberOrNull(side.top_1_match_rate) ?? numberOrNull(side.top1_match_rate),
    top_3_match_rate: numberOrNull(side.top_3_match_rate) ?? numberOrNull(side.top3_match_rate),
    critical_move_match_rate: numberOrNull(side.critical_move_match_rate) ?? numberOrNull(side.critical_match_rate),
    average_move_time_ms: numberOrNull(side.average_move_time_ms),
    move_time_consistency: numberOrNull(side.move_time_consistency),
    timing_sample_count: numberOrNull(side.timing_sample_count),
    centipawn_loss_sample_count: numberOrNull(side.centipawn_loss_sample_count),
    ranked_engine_move_sample_count: numberOrNull(side.ranked_engine_move_sample_count),
    critical_position_count: numberOrNull(side.critical_position_count),
    risk_score: numberOrNull(side.risk_score),
    risk_band: VALID_BANDS.includes(String(side.risk_band)) ? side.risk_band : 'insufficient_data',
    reasons: Array.isArray(side.reasons) ? side.reasons.filter((reason) => typeof reason === 'string').slice(0, 10) : [],
  };
}

Deno.serve(async (req) => {
  let analysisId = '';
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { matchId, gameId, force = false, mfaSessionToken } = body;
    if (!matchId || !gameId) {
      return Response.json({ error: 'matchId and gameId are required' }, { status: 400 });
    }

    const [match, game] = await Promise.all([
      base44.asServiceRole.entities.Match.get(matchId),
      base44.asServiceRole.entities.Game.get(gameId),
    ]);
    if (!match || !game || game.match_id !== match.id) {
      return Response.json({ error: 'Match or Game not found' }, { status: 404 });
    }
    const isAdmin = user.role === 'admin';
    const isParticipant = match.player1_id === user.id || match.player2_id === user.id;
    if (isAdmin) {
      const mfaError = await requireAdminMfa(base44, user, mfaSessionToken, req.headers.get('user-agent') || '');
      if (mfaError) return mfaError;
    }
    if (!isAdmin && !isParticipant) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (game.status !== 'completed') {
      return Response.json({ error: 'Only completed games can be screened' }, { status: 400 });
    }

    const existing = await base44.asServiceRole.entities.FairPlayAnalysis.filter({ match_id: match.id, game_id: game.id });
    const analysis = existing[0] || await base44.asServiceRole.entities.FairPlayAnalysis.create({
      match_id: match.id,
      game_id: game.id,
      status: 'queued',
      white_focus_loss_count: game.white_focus_loss_count || 0,
      black_focus_loss_count: game.black_focus_loss_count || 0,
      white_total_focus_lost_ms: game.white_total_focus_lost_ms || 0,
      black_total_focus_lost_ms: game.black_total_focus_lost_ms || 0,
    });
    analysisId = analysis.id;

    // Match participants may trigger their own screening idempotently, but
    // detailed results remain admin-only through the entity's RLS.
    const responseForCaller = (payload: Record<string, unknown>) =>
      isAdmin ? Response.json(payload) : Response.json({ accepted: true, status: payload.status || analysis.status });

    const forceReanalysis = force === true && isAdmin;
    if (!forceReanalysis && (analysis.status === 'completed' || analysis.status === 'manual_review')) {
      return responseForCaller({ analysis, alreadyAnalyzed: true, status: analysis.status });
    }

    const enabled = Deno.env.get('FAIR_PLAY_SCREENING_ENABLED') === 'true';
    const analyzerUrl = Deno.env.get('FAIR_PLAY_ANALYZER_URL');
    const analyzerSecret = Deno.env.get('FAIR_PLAY_ANALYZER_SECRET');
    if (!enabled || !analyzerUrl || !analyzerSecret) {
      const queued = await base44.asServiceRole.entities.FairPlayAnalysis.update(analysis.id, {
        status: 'awaiting_analyzer',
        error_message: enabled ? 'Analyzer URL or secret is not configured.' : 'Fair Play screening is not enabled.',
      });
      return responseForCaller({ analysis: queued, awaitingAnalyzer: true, status: queued.status });
    }

    await base44.asServiceRole.entities.FairPlayAnalysis.update(analysis.id, {
      status: 'processing',
      error_message: '',
    });

    const response = await fetch(new URL('/v1/analyze', analyzerUrl).toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${analyzerSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        analysis_id: analysis.id,
        match_id: match.id,
        game_id: game.id,
        pgn: game.pgn || '',
        move_log: game.move_log || [],
        time_control: match.time_control,
        focus: {
          white: { count: game.white_focus_loss_count || 0, total_ms: game.white_total_focus_lost_ms || 0 },
          black: { count: game.black_focus_loss_count || 0, total_ms: game.black_total_focus_lost_ms || 0 },
        },
      }),
    });
    if (!response.ok) throw new Error(`Analyzer returned HTTP ${response.status}`);
    const result = await response.json();
    if (!result || typeof result !== 'object') {
      throw new Error('Analyzer returned an invalid response body');
    }
    const white = normalizedSide(result.white);
    const black = normalizedSide(result.black);
    const reportedEligibleMoveCount = numberOrNull(result.eligible_move_count);
    if (reportedEligibleMoveCount !== null && reportedEligibleMoveCount > 0 && white.eligible_moves + black.eligible_moves === 0) {
      throw new Error('Analyzer response omitted per-side analyzed move counts');
    }
    const status = white.risk_band === 'review' || black.risk_band === 'review' ? 'manual_review' : 'completed';

    const completed = await base44.asServiceRole.entities.FairPlayAnalysis.update(analysis.id, {
      status,
      analyzer_version: typeof result.analyzer_version === 'string' ? result.analyzer_version : '',
      stockfish_version: typeof result.stockfish_version === 'string' ? result.stockfish_version : '',
      analysis_depth: numberOrNull(result.analysis_depth),
      eligible_move_count: reportedEligibleMoveCount,
      white_eligible_moves: white.eligible_moves,
      black_eligible_moves: black.eligible_moves,
      white_average_centipawn_loss: white.average_centipawn_loss,
      black_average_centipawn_loss: black.average_centipawn_loss,
      white_median_centipawn_loss: white.median_centipawn_loss,
      black_median_centipawn_loss: black.median_centipawn_loss,
      white_top_1_match_rate: white.top_1_match_rate,
      black_top_1_match_rate: black.top_1_match_rate,
      white_top_3_match_rate: white.top_3_match_rate,
      black_top_3_match_rate: black.top_3_match_rate,
      white_critical_move_match_rate: white.critical_move_match_rate,
      black_critical_move_match_rate: black.critical_move_match_rate,
      white_average_move_time_ms: white.average_move_time_ms,
      black_average_move_time_ms: black.average_move_time_ms,
      white_move_time_consistency: white.move_time_consistency,
      black_move_time_consistency: black.move_time_consistency,
      white_timing_sample_count: white.timing_sample_count,
      black_timing_sample_count: black.timing_sample_count,
      white_centipawn_loss_sample_count: white.centipawn_loss_sample_count,
      black_centipawn_loss_sample_count: black.centipawn_loss_sample_count,
      white_ranked_engine_move_sample_count: white.ranked_engine_move_sample_count,
      black_ranked_engine_move_sample_count: black.ranked_engine_move_sample_count,
      white_critical_position_count: white.critical_position_count,
      black_critical_position_count: black.critical_position_count,
      white_focus_loss_count: game.white_focus_loss_count || 0,
      black_focus_loss_count: game.black_focus_loss_count || 0,
      white_total_focus_lost_ms: game.white_total_focus_lost_ms || 0,
      black_total_focus_lost_ms: game.black_total_focus_lost_ms || 0,
      white_risk_score: white.risk_score,
      black_risk_score: black.risk_score,
      white_risk_band: white.risk_band,
      black_risk_band: black.risk_band,
      white_screening_reasons: white.reasons,
      black_screening_reasons: black.reasons,
      raw_analysis_summary: typeof result.summary === 'string' ? result.summary.slice(0, 10000) : '',
      analyzed_at: new Date().toISOString(),
      error_message: '',
    });

    const createReviewFlag = async (userId: string, color: string, side: ReturnType<typeof normalizedSide>) => {
      if (side.risk_band !== 'review' || !userId) return;
      const existingFlags = await base44.asServiceRole.entities.IntegrityFlag.filter({
        user_id: userId,
        match_id: match.id,
        flag_type: 'engine_assistance_suspected',
      });
      if (existingFlags.length) return;
      const flag = await base44.asServiceRole.entities.IntegrityFlag.create({
        user_id: userId,
        match_id: match.id,
        flag_type: 'engine_assistance_suspected',
        severity: 'medium',
        status: 'open',
        notes: `Automated Fair Play screening recommended human review for ${color}. Score: ${side.risk_score ?? 'unavailable'}. ${side.reasons.join(' ')}`.slice(0, 4000),
      });
      await base44.asServiceRole.entities.IntegrityAuditLog.create({
        flag_id: flag.id,
        action: 'flag_created',
        new_status: 'open',
        notes: 'Created from an external Fair Play analyzer result. No automated account, financial, or contest action was taken.',
      });
    };

    await Promise.all([
      createReviewFlag(match.player1_id, 'White', white),
      createReviewFlag(match.player2_id, 'Black', black),
    ]);

    return responseForCaller({ analysis: completed, status: completed.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fair Play analysis failed';
    if (analysisId) {
      try {
        const base44 = createClientFromRequest(req);
        await base44.asServiceRole.entities.FairPlayAnalysis.update(analysisId, {
          status: 'failed',
          error_message: message.slice(0, 2000),
        });
      } catch {
        // Preserve the original error response even if persistence is unavailable.
      }
    }
    return Response.json({ error: message }, { status: 500 });
  }
});