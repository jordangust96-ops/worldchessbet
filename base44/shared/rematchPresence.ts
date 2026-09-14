import { fail } from './challengeAccess.ts';
export const REMATCH_PRESENCE_MS = 30000;
export const REMATCH_OFFER_MS = 120000;
export function rematchRole(match: any, userId: string) {
  return match.player1_id===userId?'player1':match.player2_id===userId?'player2':'';
}
export function rematchPresent(match: any, userId: string, token?: string) {
  const role=rematchRole(match,userId), p=role && match['post_match_'+role+'_presence'];
  return Boolean(p && !p.left && p.token && (!token || p.token===token) && Number(p.until)>Date.now());
}
export async function requireRematchPresence(base44: any, match: any) {
  if (!match.challenge_in_screen_rematch) return;
  const parent=await base44.asServiceRole.entities.Match.get(match.challenge_rematch_of);
  const tokens=match.challenge_rematch_presence || {};
  if (!tokens.creator || !tokens.opponent || parent.status!=='completed' || ![parent.player1_id,parent.player2_id].includes(match.player1_id) ||
      ![parent.player1_id,parent.player2_id].includes(match.challenge_target_id) ||
      match.player1_id===match.challenge_target_id ||
      !rematchPresent(parent,match.player1_id,tokens.creator) ||
      !rematchPresent(parent,match.challenge_target_id,tokens.opponent))
    fail('opponent_left','The rematch is no longer available. Both players must remain on the result screen.',409);
}
