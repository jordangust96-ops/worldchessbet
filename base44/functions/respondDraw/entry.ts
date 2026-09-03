import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { gameId, action } = await req.json();
    if (!gameId || !['offer', 'accept', 'decline', 'cancel'].includes(action)) {
      return Response.json({ error: 'gameId and a valid action are required' }, { status: 400 });
    }

    const game = await base44.asServiceRole.entities.Game.get(gameId);
    if (!game) return Response.json({ error: 'Game not found' }, { status: 404 });
    if (Number(game.launch_epoch) !== 2) return Response.json({ error: 'Game not available' }, { status: 410 });
    if (game.status === 'completed') {
      return Response.json({ error: 'Game has already ended' }, { status: 400 });
    }

    const match = await base44.asServiceRole.entities.Match.get(game.match_id);
    if (!match) return Response.json({ error: 'Match not found' }, { status: 404 });

    const isP1 = match.player1_id === user.id;
    const isP2 = match.player2_id === user.id;
    if (!isP1 && !isP2) {
      return Response.json({ error: 'You are not a player in this match' }, { status: 403 });
    }

    // Every branch below re-fetches and re-validates immediately before its
    // write. Game.update is a merge-patch, not compare-and-set, and several
    // other paths (submitMove, resignGame, checkTimeout, and this function
    // itself called again) can change draw_offered_by or complete the game
    // in the gap between the read above and here — without this, a stale
    // accept could silently overwrite a real checkmate/resignation/timeout
    // result with a draw, misdirecting settlement.

    if (action === 'offer') {
      if (game.draw_offered_by) {
        return Response.json({ error: 'A draw offer is already pending' }, { status: 400 });
      }
      const preCommitGame = await base44.asServiceRole.entities.Game.get(gameId);
      if (!preCommitGame || preCommitGame.status === 'completed') {
        return Response.json({ error: 'Game has already ended' }, { status: 400 });
      }
      if (preCommitGame.draw_offered_by) {
        return Response.json({ error: 'A draw offer is already pending' }, { status: 400 });
      }
      const updatedGame = await base44.asServiceRole.entities.Game.update(gameId, {
        draw_offered_by: user.id,
      });
      return Response.json({ game: updatedGame });
    }

    if (action === 'cancel') {
      // Lets the offering player retract their own still-pending offer,
      // rather than leaving it live and acceptable indefinitely with no way
      // to withdraw it.
      if (game.draw_offered_by !== user.id) {
        return Response.json({ error: 'You do not have an active draw offer to cancel' }, { status: 400 });
      }
      const preCommitGame = await base44.asServiceRole.entities.Game.get(gameId);
      if (!preCommitGame || preCommitGame.status === 'completed') {
        return Response.json({ error: 'Game has already ended' }, { status: 400 });
      }
      if (preCommitGame.draw_offered_by !== user.id) {
        return Response.json({ error: 'This draw offer is no longer active' }, { status: 409 });
      }
      const updatedGame = await base44.asServiceRole.entities.Game.update(gameId, {
        draw_offered_by: '',
      });
      return Response.json({ game: updatedGame });
    }

    if (!game.draw_offered_by) {
      return Response.json({ error: 'There is no pending draw offer' }, { status: 400 });
    }
    if (game.draw_offered_by === user.id) {
      return Response.json({ error: 'You cannot respond to your own draw offer' }, { status: 403 });
    }

    if (action === 'decline') {
      const preCommitGame = await base44.asServiceRole.entities.Game.get(gameId);
      if (!preCommitGame || preCommitGame.status === 'completed') {
        return Response.json({ error: 'Game has already ended' }, { status: 400 });
      }
      if (preCommitGame.draw_offered_by !== game.draw_offered_by) {
        return Response.json({ error: 'This draw offer is no longer active' }, { status: 409 });
      }
      const updatedGame = await base44.asServiceRole.entities.Game.update(gameId, {
        draw_offered_by: '',
      });
      return Response.json({ game: updatedGame });
    }

    // action === 'accept'
    const preCommitGame = await base44.asServiceRole.entities.Game.get(gameId);
    if (!preCommitGame || preCommitGame.status === 'completed') {
      return Response.json({ error: 'Game has already ended' }, { status: 400 });
    }
    if (preCommitGame.draw_offered_by !== game.draw_offered_by) {
      return Response.json({ error: 'This draw offer is no longer active' }, { status: 409 });
    }
    const updatedGame = await base44.asServiceRole.entities.Game.update(gameId, {
      status: 'completed',
      result: 'draw',
      winner_id: '',
      end_reason: 'draw_agreement',
      completed_at: new Date().toISOString(),
      draw_offered_by: '',
    });
    return Response.json({ game: updatedGame });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});