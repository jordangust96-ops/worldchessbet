// Resolves the most recent completed/manual_review FairPlayAnalysis for a
// match and serializes the one side (white/black) belonging to `userId` into
// a compact JSON string suitable for CaseEvidence.fair_play_analysis (a
// plain string field, not a structured object, per its schema). Returns ''
// whenever there is nothing to attach (no analysis yet, still queued/failed,
// or userId is not a participant in the match) so callers can set the field
// unconditionally without an extra existence check.
//
// Used by both submitContestReport (evidence for the REPORTED player — the
// one a fair-play complaint would be about) and manageIntegrityFlag's
// open_case (evidence for the flagged player, i.e. flag.user_id) so a case
// opened either way carries the same Stockfish/engine-correlation evidence
// that already existed on the match, instead of leaving
// CaseEvidence.fair_play_analysis permanently unpopulated.
export async function buildFairPlayAnalysisEvidence(base44: any, {
  matchId,
  userId,
  match = null,
}: {
  matchId: string;
  userId: string;
  match?: { player1_id?: string; player2_id?: string } | null;
}): Promise<string> {
  if (!matchId || !userId) return '';

  const analyses = await base44.asServiceRole.entities.FairPlayAnalysis.filter(
    { match_id: matchId },
    '-analyzed_at',
    5
  );
  const analysis = analyses.find((a: any) => ['completed', 'manual_review'].includes(a.status));
  if (!analysis) return '';

  const resolvedMatch = match || (await base44.asServiceRole.entities.Match.get(matchId).catch(() => null));
  if (!resolvedMatch) return '';

  let side: 'white' | 'black';
  if (resolvedMatch.player1_id === userId) side = 'white';
  else if (resolvedMatch.player2_id === userId) side = 'black';
  else return '';

  return JSON.stringify({
    analysis_id: analysis.id,
    side,
    status: analysis.status,
    analyzer_version: analysis.analyzer_version || '',
    stockfish_version: analysis.stockfish_version || '',
    analysis_depth: analysis.analysis_depth ?? null,
    eligible_moves: analysis[`${side}_eligible_moves`] ?? null,
    risk_score: analysis[`${side}_risk_score`] ?? null,
    risk_band: analysis[`${side}_risk_band`] || 'insufficient_data',
    average_centipawn_loss: analysis[`${side}_average_centipawn_loss`] ?? null,
    median_centipawn_loss: analysis[`${side}_median_centipawn_loss`] ?? null,
    top_1_match_rate: analysis[`${side}_top_1_match_rate`] ?? null,
    top_3_match_rate: analysis[`${side}_top_3_match_rate`] ?? null,
    critical_move_match_rate: analysis[`${side}_critical_move_match_rate`] ?? null,
    screening_reasons: analysis[`${side}_screening_reasons`] || [],
    analyzed_at: analysis.analyzed_at || '',
  });
}
