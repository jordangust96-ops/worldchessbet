import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Regression test for Findings #6/#7 from the full referential-integrity audit:
//
// Finding #6: IntegrityFlag and DisputeCase were only linked via a free-text
// mention of the flag id inside report_description/DisputeCaseNote content
// when manageIntegrityFlag's open_case action converted a flag into a case —
// no structured, queryable field on either record pointed at the other.
//
// Finding #7: CaseEvidence.fair_play_analysis was a schema field that no
// code path ever populated, even for a case that originated from an
// engine_assistance_suspected (Stockfish) flag, or a fair_play-category
// player report against an opponent who already had a completed analysis.

// --- Model: buildFairPlayAnalysisEvidence's side-resolution logic (which
// color a given userId played, and which this-side-only fields get pulled
// out of a two-sided FairPlayAnalysis record).
function resolveSide(match, userId) {
  if (match.player1_id === userId) return 'white';
  if (match.player2_id === userId) return 'black';
  return null;
}
function pickSideFields(analysis, side) {
  return {
    risk_score: analysis[`${side}_risk_score`] ?? null,
    risk_band: analysis[`${side}_risk_band`] || 'insufficient_data',
    screening_reasons: analysis[`${side}_screening_reasons`] || [],
  };
}

{
  const match = { player1_id: 'user-white', player2_id: 'user-black' };
  assert.equal(resolveSide(match, 'user-white'), 'white', 'player1 resolves to the white side');
  assert.equal(resolveSide(match, 'user-black'), 'black', 'player2 resolves to the black side');
  assert.equal(resolveSide(match, 'user-spectator'), null, 'a non-participant resolves to no side at all — never guesses');

  const analysis = {
    white_risk_score: 0.91, white_risk_band: 'review', white_screening_reasons: ['top-1 match rate anomalous'],
    black_risk_score: 0.12, black_risk_band: 'cleared', black_screening_reasons: [],
  };
  const flaggedSide = pickSideFields(analysis, resolveSide(match, 'user-white'));
  assert.equal(flaggedSide.risk_band, 'review', "the flagged player's own side data is pulled, not their opponent's");
  assert.equal(flaggedSide.risk_score, 0.91);
}

// --- Cross-check against the actual deployed source.
const [
  disputeCaseSchemaSrc, integrityFlagSchemaSrc, fairPlayEvidenceSrc, manageIntegrityFlagSrc, submitContestReportSrc,
] = await Promise.all([
  readFile(new URL('../base44/entities/DisputeCase.jsonc', import.meta.url), 'utf8'),
  readFile(new URL('../base44/entities/IntegrityFlag.jsonc', import.meta.url), 'utf8'),
  readFile(new URL('../base44/shared/fairPlayEvidence.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/manageIntegrityFlag/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/submitContestReport/entry.ts', import.meta.url), 'utf8'),
]);

// Finding #6: structured, reciprocal link.
assert.match(disputeCaseSchemaSrc, /"integrity_flag_id"/, 'DisputeCase schema carries a structured integrity_flag_id field');
assert.match(integrityFlagSchemaSrc, /"dispute_case_id"/, 'IntegrityFlag schema carries a structured dispute_case_id field');
assert.match(manageIntegrityFlagSrc, /integrity_flag_id: flagId,/, "open_case sets DisputeCase.integrity_flag_id to the source flag's id");
assert.match(manageIntegrityFlagSrc, /flagUpdates\.dispute_case_id = disputeCase\.id;/, "open_case sets IntegrityFlag.dispute_case_id to the new case's id");

// Finding #7: fair_play_analysis actually gets populated now, on both the
// flag-originated path and the user-report path.
assert.match(fairPlayEvidenceSrc, /export async function buildFairPlayAnalysisEvidence/, 'a shared helper resolves and serializes the relevant side of a FairPlayAnalysis record');
assert.match(fairPlayEvidenceSrc, /\['completed', 'manual_review'\]\.includes\(a\.status\)/, 'the helper only uses a FairPlayAnalysis that has actually finished (not queued/processing/failed)');

assert.match(manageIntegrityFlagSrc, /buildFairPlayAnalysisEvidence\(base44, \{ matchId: flag\.match_id, userId: flag\.user_id, match \}\)/, "open_case resolves fair-play evidence for the FLAGGED user (flag.user_id), not the admin");
assert.match(manageIntegrityFlagSrc, /fair_play_analysis: fairPlayAnalysis,/, "open_case's CaseEvidence.create now sets fair_play_analysis");

assert.match(submitContestReportSrc, /buildFairPlayAnalysisEvidence\(base44, \{ matchId, userId: opponentId, match \}\)/, "submitContestReport resolves fair-play evidence for the REPORTED player (the opponent), not the reporter");
assert.match(submitContestReportSrc, /fair_play_analysis: fairPlayAnalysis,/, "submitContestReport's CaseEvidence.create now sets fair_play_analysis");

console.log('Integrity flag <-> dispute case linkage and fair-play evidence validation passed.');
