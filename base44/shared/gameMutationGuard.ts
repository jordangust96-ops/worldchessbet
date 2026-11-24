import { acquireMatchLock, releaseMatchLock, refreshContestLocks } from './seamlessAtomicStore.ts';

// Compare under the shared per-game lease, immediately before writing.
// Metadata-only heartbeat/focus updates must never invalidate a legal move.
const fields = ['fen','status','result','winner_id','turn_started_at','white_time_ms','black_time_ms','draw_offered_by'];
const fingerprint = (game: any) => JSON.stringify(fields.map(key => game?.[key] ?? null));
export function guardGameMutations(base44: any, options: { waitForLease?: boolean } = {}) {
  const entity = base44.asServiceRole.entities.Game;
  const snapshots = new Map();
  const presenceSnapshots = new Map();
  const presenceFields = ['white_last_seen_at','black_last_seen_at','white_disconnected_at','black_disconnected_at','white_disconnect_policy_version','black_disconnect_policy_version','disconnect_timeout_candidate_at','disconnect_timeout_candidate_color'];
  const presenceFingerprint = (game: any) => JSON.stringify(presenceFields.map(key => game?.[key] ?? null));
  const remember = (game: any) => {
    if (game?.id && !snapshots.has(game.id)) snapshots.set(game.id, fingerprint(game));
    if (game?.id) presenceSnapshots.set(game.id, presenceFingerprint(game));
    return game;
  };
  const guarded = new Proxy(entity, {
    get(target, property) {
      if (property === 'get') return async (...args: any[]) => remember(await target.get(...args));
      if (property === 'filter') return async (...args: any[]) => {
        const rows = await target.filter(...args); rows.forEach(remember); return rows;
      };
      if (property === 'update') return async (id: string, patch: any) => {
        if (!snapshots.has(id)) throw new Error('Game must be read before updating');
        const scope = 'game-mutation:' + id;
        const owner = crypto.randomUUID();
        // Moves may briefly wait for a presence write, without retrying the
        // move or its write. Re-check the original state under the lease below.
        let acquired = await acquireMatchLock(scope, owner);
        for (let attempt = 0; !acquired && options.waitForLease && attempt < 6; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          acquired = await acquireMatchLock(scope, owner);
        }
        if (!acquired) {
          throw Object.assign(new Error('Game update in progress. Reconnecting to the latest position.'), {status:409, code:'game_lease_busy'});
        }
        try {
          const latest = await target.get(id);
          if (!latest || fingerprint(latest) !== snapshots.get(id))
            throw Object.assign(new Error('Game state changed; reconnect to the latest position.'), {status:409});
          // Presence writes and disconnect results must use the most recent
          // contact state. Legal moves still ignore unrelated heartbeat changes.
          const presenceSensitive = patch.end_reason === 'disconnect_timeout' ||
            (!patch.fen && presenceFields.some(key => Object.hasOwn(patch, key)));
          if (presenceSensitive && presenceFingerprint(latest) !== presenceSnapshots.get(id))
            throw Object.assign(new Error('Player connection changed; retry with the latest state.'), {status:409});
          if (!await refreshContestLocks(scope, [], owner))
            throw Object.assign(new Error('Game update could not be confirmed. Reconnect before trying again.'), {status:503});
          const updated = await target.update(id, patch);
          snapshots.set(id, fingerprint(updated));
          presenceSnapshots.set(id, presenceFingerprint(updated));
          return updated;
        } finally {
          // A release failure cannot turn an already-committed move into a failed response.
          await releaseMatchLock(scope, owner).catch(() => {});
        }
      };
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  const entities = new Proxy(base44.asServiceRole.entities, {get(target, property) {return property === 'Game' ? guarded : target[property];}});
  const service = new Proxy(base44.asServiceRole, {get(target, property) {return property === 'entities' ? entities : target[property];}});
  return new Proxy(base44, {get(target, property) {return property === 'asServiceRole' ? service : target[property];}});
}
