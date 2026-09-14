import { assertFreeMatch } from './challengePolicy.js';
import { acquireMatchLock, refreshContestLocks, releaseMatchLock } from './seamlessAtomicStore.ts';

// A free game's immutable result record uses the existing contest history.
// It contains no financial operations; completion never accesses a wallet.
export async function completeFreeGame(base44: any, matchId: string, gameId: string) {
  const owner=crypto.randomUUID();
  if (!await acquireMatchLock(matchId,owner)) throw new Error('free_completion_busy');
  const checkLease=async()=>{if(!await refreshContestLocks(matchId,[],owner))throw new Error('free_completion_lease_lost');};
  try {
    const [match,game]=await Promise.all([
      base44.asServiceRole.entities.Match.get(matchId),
      base44.asServiceRole.entities.Game.get(gameId),
    ]);
    assertFreeMatch(match);
    if (game.play_mode!=='free' || game.status!=='completed' || game.match_id!==match.id ||
        match.game_id!==game.id || game.player1_id!==match.player1_id || game.player2_id!==match.player2_id ||
        !['in_progress','completed'].includes(match.status) || !['white_win','black_win','draw'].includes(game.result))
      throw new Error('invalid_free_game_result');
    const winner=game.result==='white_win'?match.player1_id:game.result==='black_win'?match.player2_id:'';
    if((game.winner_id || '')!==winner)throw new Error('invalid_free_game_winner');
    const records=await base44.asServiceRole.entities.ContestRecord.filter({match_id:match.id},'created_date',2);
    if(records.length>1)throw new Error('duplicate_free_game_record');
    if(records[0] && (records[0].game_id!==game.id || records[0].play_mode!=='free' ||
        records[0].white_player_id!==match.player1_id || records[0].black_player_id!==match.player2_id ||
        (records[0].winner_id || '')!==winner))throw new Error('free_game_record_conflict');
    await checkLease();
    if(!records[0]) {
      const users=await Promise.all([match.player1_id,match.player2_id].map(id=>base44.asServiceRole.entities.User.get(id)));
      await checkLease();
      await base44.asServiceRole.entities.ContestRecord.create({
        launch_epoch:2,play_mode:'free',match_id:match.id,game_id:game.id,is_private:!!match.is_private,
        time_control:match.time_control,display_name:match.display_name || '',
        entry_amount:0,contest_pool:0,platform_fee:0,platform_fee_per_player:0,winner_payout:0,
        platform_fee_schedule_version:'',ledger_entry_ids:[],wallet_transaction_ids:[],
        white_player_id:match.player1_id,black_player_id:match.player2_id,
        white_username:users[0]?.chess_com_username || '',black_username:users[1]?.chess_com_username || '',
        contest_start_at:game.started_at || game.turn_started_at,contest_end_at:game.completed_at,
        settlement_timestamp:game.completed_at,pgn:game.pgn || '',move_log:game.move_log || [],
        final_fen:game.fen || '',total_moves:(game.move_log || []).length,
        winner_id:winner,loser_id:winner?(winner===match.player1_id?match.player2_id:match.player1_id):'',
        outcome_type:game.end_reason || '',integrity_investigation_flag:false,dispute_status:'none',
        white_total_disconnected_ms:game.white_total_disconnected_ms || 0,
        black_total_disconnected_ms:game.black_total_disconnected_ms || 0,
      });
    }
    // A retry repairs a lost final Match write using the same immutable record.
    await checkLease();
    if(match.status==='completed')return {alreadySettled:true,match};
    const updated=await base44.asServiceRole.entities.Match.update(match.id,{
      status:'completed',winner_id:winner,
      result:game.result==='white_win'?'player1_win':game.result==='black_win'?'player2_win':'draw',
      completed_at:game.completed_at,
    });
    return {match:updated,freePlay:true};
  } finally {await releaseMatchLock(matchId,owner).catch(()=>{});}
}
