import { acquireMatchLock, releaseMatchLock, refreshContestLocks } from './seamlessAtomicStore.ts';

// Compare under the shared per-game lease, immediately before writing.
// Metadata-only heartbeat/focus updates must never invalidate a legal move.
const fields = ['fen','status','result','winner_id','turn_started_at','white_time_ms','black_time_ms','draw_offered_by'];
const fingerprint = (game: any) => JSON.stringify(fields.map(key => game?.[key] ?? null));
export function guardGameMutations(base44: any, options: { waitForLease?: boolean } = {}) {
  const entity = base44.asServiceRole.entities.Game;
  const snapshots = new Map();
  const remember = (game: any) => {
    if (game?.id && !snapshots.has(game.id)) snapshots.set(game.id, fingerprint(game));
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
          if (!await refreshContestLocks(scope, [], owner))
            throw Object.assign(new Error('Game update could not be confirmed. Reconnect before trying again.'), {status:503});
          const updated = await target.update(id, patch);
          snapshots.set(id, fingerprint(updated));
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
