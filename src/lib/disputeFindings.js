// Derives a plain-English "System Findings" summary and a non-binding
// recommended action from data already loaded on the admin case page.
// Purely informational — never triggers anything automatically.
export function buildSystemFindings({ disputeCase, match, game, contestRecord }) {
  const facts = [];
  const outcome = contestRecord?.outcome_type || game?.end_reason;

  if (contestRecord) facts.push('Settlement completed');
  if (outcome === 'checkmate') facts.push('Match completed normally (checkmate)');
  if (outcome === 'draw_agreement') facts.push('Draw agreed by both players');
  if (outcome === 'stalemate' || outcome === 'threefold_repetition' || outcome === 'insufficient_material' || outcome === 'fifty_move_rule') {
    facts.push(`Match ended in a draw (${outcome.replace(/_/g, ' ')})`);
  }
  if (outcome === 'timeout' || outcome === 'timeout_vs_insufficient_material') facts.push('Clock expiration / timeout detected');

  if ((game?.white_total_disconnected_ms || 0) > 0 || (game?.black_total_disconnected_ms || 0) > 0) {
    facts.push('Disconnect detected during the match');
  }
  if (game?.white_reconnected_at || game?.black_reconnected_at) facts.push('Reconnection attempt recorded');

  if (disputeCase?.fair_play_review_flag) facts.push('Fair Play review flag set');
  if (disputeCase?.aml_review_flag) facts.push('AML/compliance review flag set');
  if (disputeCase?.manual_settlement_review_flag) facts.push('Manual settlement review flag set');
  if (disputeCase?.escalated) facts.push('Case has been escalated');
  if (match?.settlement_hold) facts.push('Settlement is currently on hold pending investigation');

  if (facts.length === 0) facts.push('No automated findings available for this case yet.');

  let recommendedAction = null;
  if (disputeCase?.fair_play_review_flag) {
    recommendedAction = 'Escalate for Fair Play / anti-cheat investigation';
  } else if ((outcome === 'timeout' || outcome === 'timeout_vs_insufficient_material') && disputeCase?.report_category === 'technical_issue') {
    recommendedAction = 'Review contest for a technical-issue void (disconnect/timeout dispute)';
  } else if (disputeCase?.aml_review_flag) {
    recommendedAction = 'Continue AML/compliance review before releasing any hold';
  }

  return { facts, recommendedAction };
}