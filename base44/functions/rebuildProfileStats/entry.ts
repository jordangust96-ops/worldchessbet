import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

const PAGE_SIZE = 500;
const INVALID_RESULTS = new Set(['contest_reversed', 'contest_voided']);

async function listAll(entity: any, sort: string) {
  const rows = [];
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const page = await entity.list(sort, PAGE_SIZE, skip);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function emptyStats() {
  return { games_played: 0, games_won: 0, games_lost: 0, win_percentage: 0 };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  }
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me().catch(() => null);
    if (!admin?.id || admin.role !== 'admin') {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some((key) => key !== 'dryRun')) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }
    const dryRun = body.dryRun !== false;
    const entities = base44.asServiceRole.entities;
    const [records, cases, users] = await Promise.all([
      listAll(entities.ContestRecord, 'settlement_timestamp'),
      listAll(entities.DisputeCase, 'created_date'),
      listAll(entities.User, 'created_date'),
    ]);

    const invalidMatchIds = new Set(cases
      .filter((row: any) => INVALID_RESULTS.has(row.resolution_type) && row.match_id)
      .map((row: any) => row.match_id));
    const totals = new Map<string, ReturnType<typeof emptyStats>>();
    const currentRecords = records.filter((record: any) =>
      ['free', 'money'].includes(record.play_mode) && !invalidMatchIds.has(record.match_id));

    for (const record of currentRecords) {
      const participantIds = [...new Set([record.white_player_id, record.black_player_id].filter(Boolean))];
      for (const userId of participantIds) {
        const stats = totals.get(userId) || emptyStats();
        stats.games_played += 1;
        if (record.winner_id === userId) stats.games_won += 1;
        if (record.loser_id === userId) stats.games_lost += 1;
        totals.set(userId, stats);
      }
    }

    const changes = [];
    for (const user of users) {
      const next = totals.get(user.id) || emptyStats();
      next.win_percentage = next.games_played > 0
        ? Math.round((next.games_won / next.games_played) * 100)
        : 0;
      const previous = {
        games_played: Number(user.games_played || 0),
        games_won: Number(user.games_won || 0),
        games_lost: Number(user.games_lost || 0),
        win_percentage: Number(user.win_percentage || 0),
      };
      if (Object.keys(next).some((key) => previous[key] !== next[key])) {
        changes.push({ user_id: user.id, previous, next });
      }
    }

    if (!dryRun) {
      for (const change of changes) {
        await entities.User.update(change.user_id, change.next);
      }
    }

    return Response.json({
      dry_run: dryRun,
      users_checked: users.length,
      current_contests_counted: currentRecords.length,
      invalid_contests_excluded: invalidMatchIds.size,
      users_changed: changes.length,
      changes,
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'profile_stats_rebuild_failed',
      diagnostic: String(error?.message || 'unknown_error').slice(0, 500),
    }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
