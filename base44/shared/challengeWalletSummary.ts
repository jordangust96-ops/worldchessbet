import { readFundingState, readFundingSources } from './fundingProvenance.ts';
import { fundingSummary } from './fundingProvenancePure.js';
export async function challengeWalletSummary(base44: any,userId: string) {
  const state=await readFundingState(base44,userId);
  const sources=await readFundingSources(base44,{[userId]:state});
  let reservedCents=0;
  for (const [key,lots] of Object.entries(state.held)) {
    if (!key.startsWith('match:')) continue;
    const match=await base44.asServiceRole.entities.Match.get(key.slice(6));
    if ([match.player1_id,match.player2_id].includes(userId) &&
        ['searching','preparing','both_ready','in_progress','settling','cancelling','disputed'].includes(match.status))
      reservedCents+=(lots as any[]).reduce((n,lot)=>n+lot.cents,0);
  }
  return {...fundingSummary(state,sources),reserved_for_matches:reservedCents/100};
}
