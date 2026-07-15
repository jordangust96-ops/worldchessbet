import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Lightweight, rule-based integrity checks. Runs asynchronously after a
// contest completes (invoked by settleMatch) so it never blocks gameplay or
// settlement. It only ever CREATES IntegrityFlag records for manual admin
// review — it never suspends users, cancels contests, or touches funds.
//
// Designed to be extended: each rule below is a small, independent block.
// Future rules (engine detection, behavioral analysis, payment risk scoring,
// etc.) can be added the same way without touching existing rules.

const DAY_MS = 24 * 60 * 60 * 1000;

function plyCount(pgn) {
  if (!pgn) return 0;
  const cleaned = pgn.replace(/\d+\.(\.\.)?/g, ' ').replace(/\{[^}]*\}/g, ' ').trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { matchId, gameId } = await req.json();
    if (!matchId || !gameId) {
      return Response.json({ error: 'matchId and gameId are required' }, { status: 400 });
    }

    const match = await base44.asServiceRole.entities.Match.get(matchId);
    const game = await base44.asServiceRole.entities.Game.get(gameId);
    if (!match || !game) {
      return Response.json({ error: 'Match or Game not found' }, { status: 404 });
    }

    const nowIso = new Date().toISOString();
    const dayAgoIso = new Date(Date.now() - DAY_MS).toISOString();
    const flagsCreated = [];

    // Avoid spamming duplicate flags — skip if an open/under_review flag of the
    // same type already exists for this user from within the last 24 hours.
    const hasRecentOpenFlag = async (userId, flagType) => {
      const existing = await base44.asServiceRole.entities.IntegrityFlag.filter({ user_id: userId, flag_type: flagType });
      return existing.some(
        (f) => (f.status === 'open' || f.status === 'under_review') && new Date(f.created_date).getTime() >= Date.now() - DAY_MS
      );
    };

    // Sends admins a heads-up for high-severity activity. Never emailed to the
    // flagged user — only admins take actions that reach the user.
    const notifyAdminsIfNeeded = async (userId, severity) => {
      const highFlags = await base44.asServiceRole.entities.IntegrityFlag.filter({ user_id: userId, severity: 'high' });
      const shouldNotify = severity === 'high' || highFlags.length >= 2;
      if (!shouldNotify) return;
      const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
      const targetUser = await base44.asServiceRole.entities.User.get(userId);
      for (const admin of admins) {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: admin.email,
          subject: 'ChessBet Integrity Alert',
          body:
            `An integrity flag requires review.\n\nUser: ${targetUser?.full_name || targetUser?.email || userId}\nSeverity: ${severity}\nTotal high-severity flags: ${highFlags.length}\n\nPlease review this user in the Integrity Review Queue.`,
        }).catch(() => {});
      }
    };

    const createFlag = async ({ userId, flagType, severity, notes }) => {
      if (await hasRecentOpenFlag(userId, flagType)) return;
      const flag = await base44.asServiceRole.entities.IntegrityFlag.create({
        user_id: userId,
        match_id: match.id,
        flag_type: flagType,
        severity,
        status: 'open',
        notes,
      });
      await base44.asServiceRole.entities.IntegrityAuditLog.create({
        flag_id: flag.id,
        action: 'flag_created',
        new_status: 'open',
        notes: `Automatically created by runIntegrityCheck at ${nowIso}: ${notes}`,
      });
      flagsCreated.push(flag.id);
      await notifyAdminsIfNeeded(userId, severity);
    };

    const p1 = match.player1_id;
    const p2 = match.player2_id;
    const winnerId = game.winner_id;
    const loserId = [p1, p2].filter(Boolean).find((id) => id !== winnerId) || null;

    // Rule: Repeated Opponent Pairing — more than 10 private contests between
    // the same two players within 24 hours.
    if (match.is_private && p1 && p2) {
      const recentPrivate = await base44.asServiceRole.entities.Match.filter({ is_private: true, status: 'completed' });
      const pairCount = recentPrivate.filter(
        (m) =>
          new Date(m.completed_at || m.created_date).getTime() >= Date.now() - DAY_MS &&
          ((m.player1_id === p1 && m.player2_id === p2) || (m.player1_id === p2 && m.player2_id === p1))
      ).length;
      if (pairCount > 10) {
        await createFlag({
          userId: p1,
          flagType: 'repeated_opponent_pairing',
          severity: 'low',
          notes: `${pairCount} private contests against the same opponent (user ${p2}) in the last 24 hours.`,
        });
      }
    }

    // Rule: Repeated Resignations — resigning within the first 10 moves more
    // than 3 times in 24 hours.
    if (game.end_reason === 'resignation' && loserId && plyCount(game.pgn) <= 10) {
      const recentResignations = await base44.asServiceRole.entities.Game.filter({ end_reason: 'resignation' });
      let count = 0;
      for (const g of recentResignations) {
        if (new Date(g.completed_at || g.created_date).getTime() < Date.now() - DAY_MS) continue;
        if (plyCount(g.pgn) > 10) continue;
        const m = await base44.asServiceRole.entities.Match.get(g.match_id).catch(() => null);
        if (!m) continue;
        const gLoser = [m.player1_id, m.player2_id].filter(Boolean).find((id) => id !== g.winner_id);
        if (gLoser === loserId) count += 1;
      }
      if (count > 3) {
        await createFlag({
          userId: loserId,
          flagType: 'unusual_resignation_pattern',
          severity: 'medium',
          notes: `Resigned within the first 10 moves ${count} times in the last 24 hours.`,
        });
      }
    }

    // Rule: Repeated Timeouts — losing on time more than 5 times in 24 hours.
    if (game.end_reason === 'timeout' && loserId) {
      const recentTimeouts = await base44.asServiceRole.entities.Game.filter({ end_reason: 'timeout' });
      let count = 0;
      for (const g of recentTimeouts) {
        if (new Date(g.completed_at || g.created_date).getTime() < Date.now() - DAY_MS) continue;
        const m = await base44.asServiceRole.entities.Match.get(g.match_id).catch(() => null);
        if (!m) continue;
        const gLoser = [m.player1_id, m.player2_id].filter(Boolean).find((id) => id !== g.winner_id);
        if (gLoser === loserId) count += 1;
      }
      if (count > 5) {
        await createFlag({
          userId: loserId,
          flagType: 'unusual_timeout_pattern',
          severity: 'medium',
          notes: `Lost on time ${count} times in the last 24 hours.`,
        });
      }
    }

    return Response.json({ checked: true, flagsCreated, checkedAsOf: nowIso, dayAgoIso });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});