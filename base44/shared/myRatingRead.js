// Read-only projection for the authenticated player's profile. No rating locks,
// processor imports, entity mutations, or launch-critical dependencies.
export const RATING_POOLS = ['blitz', 'rapid', 'classical'];
const PAGE_SIZE = 20;
const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
const close = (a, b) => typeof a === 'number' && typeof b === 'number' &&
  Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.000001;

const emptyPool = (timeControl, status) => ({
  time_control: timeControl, status, rating: null, games_rated: null,
});
const hidden = (status) => ({
  status, provisional_games: 10,
  pools: RATING_POOLS.map((pool) => emptyPool(pool, status)),
  history: null,
});
async function configRead(entities) {
  const rows = await entities.RatingSystemConfig.filter({ config_key: 'primary' }, '-created_date', 2);
  return rows.length === 1 ? rows[0] : null;
}
const fence = (config) => JSON.stringify([
  config?.id, config?.public_enabled, config?.processing_enabled,
  config?.current_generation, config?.rebuild_in_progress,
  config?.rebuild_request_counter, config?.rebuild_target_generation,
  config?.algorithm_version, config?.provisional_games,
]);

export async function readMyRating(entities, userId, input = {}) {
  if (typeof userId !== 'string' || !userId) throw new Error('authentication_required');
  const pool = input.time_control ?? 'blitz';
  if (!RATING_POOLS.includes(pool)) throw new Error('invalid_request');
  if (input.before_game != null && (!validCount(input.before_game) || input.before_game < 1)) {
    throw new Error('invalid_request');
  }
  if (input.generation != null && !validCount(input.generation)) throw new Error('invalid_request');
  const config = await configRead(entities);
  if (!config) return hidden('unavailable');
  // Hide numeric values, counts, and history even from admins using this endpoint.
  if (config.public_enabled !== true) return hidden('coming_soon');
  if (!validCount(config.current_generation)) return hidden('unavailable');
  if (config.rebuild_in_progress === true) return hidden('updating');
  const generation = config.current_generation;
  if (input.before_game != null && input.generation !== generation) return hidden('updating');
  const threshold = validCount(config.provisional_games) && config.provisional_games > 0
    ? config.provisional_games : 10;
  const operations = new Map();
  async function completed(event) {
    if (!event.operation_id) return false;
    if (!operations.has(event.operation_id)) {
      operations.set(event.operation_id, entities.RatingOperation.filter({ id: event.operation_id }, '-created_date', 2));
    }
    const rows = await operations.get(event.operation_id);
    const operation = rows.length === 1 ? rows[0] : null;
    return operation?.status === 'completed' &&
      (operation.player1_id === userId || operation.player2_id === userId) &&
      operation.game_id === event.game_id && operation.time_control === event.time_control &&
      // Rebuild events reference the original completed operation, which keeps
      // its original generation. Only normal events require generation equality.
      (event.source === 'rebuild' || operation.generation === generation);
  }
  function validEvent(event, timeControl) {
    return event.user_id === userId && event.time_control === timeControl &&
      event.generation === generation && event.event_type === 'game' &&
      event.algorithm_version === config.algorithm_version &&
      validCount(event.games_rated_after) && event.games_rated_after > 0 &&
      event.games_rated_before === event.games_rated_after - 1 &&
      close(event.rating_before, event.rating_before) && close(event.rating_after, event.rating_after) &&
      [0, 0.5, 1].includes(event.score) &&
      ['normal', 'rebuild'].includes(event.source) &&
      Number.isFinite(Date.parse(event.settlement_timestamp));
  }
  const pools = await Promise.all(RATING_POOLS.map(async (timeControl) => {
    const [rows, events] = await Promise.all([
      entities.PlayerRating.filter({ user_id: userId, time_control: timeControl }, '-created_date', 2),
      entities.RatingEvent.filter({ user_id: userId, time_control: timeControl, generation }, '-games_rated_after', 2),
    ]);
    const row = rows[0];
    if (rows.length > 1 || (row && (row.generation !== generation ||
        row.algorithm_version !== config.algorithm_version || !validCount(row.games_rated)))) {
      return emptyPool(timeControl, 'updating');
    }
    if (!row || row.games_rated === 0) {
      return events.length ? emptyPool(timeControl, 'updating') : {
        ...emptyPool(timeControl, 'unrated'), games_rated: 0,
      };
    }
    const latest = events[0];
    if (!latest || !validEvent(latest, timeControl) ||
        latest.games_rated_after !== row.games_rated || !close(latest.rating_after, row.rating) ||
        latest.game_id !== row.last_game_id ||
        (events[1] && events[1].games_rated_after !== latest.games_rated_after - 1) ||
        !(await completed(latest))) return emptyPool(timeControl, 'updating');
    return {
      time_control: timeControl,
      status: row.games_rated < threshold ? 'provisional' : 'established',
      rating: Math.round(row.rating), games_rated: row.games_rated,
    };
  }));
  const selected = pools.find((item) => item.time_control === pool);
  let history = null;
  if (selected && ['provisional', 'established'].includes(selected.status)) {
    const before = Math.min(input.before_game ?? selected.games_rated + 1, selected.games_rated + 1);
    const events = await entities.RatingEvent.filter({
      user_id: userId, time_control: pool, generation,
      games_rated_after: { $lt: before },
    }, '-games_rated_after', PAGE_SIZE + 1);
    let expected = before - 1;
    let valid = true;
    let newer = null;
    for (const event of events) {
      if (!validEvent(event, pool) || event.games_rated_after !== expected ||
          (newer && !close(newer.rating_before, event.rating_after)) || !(await completed(event))) {
        valid = false;
        break;
      }
      newer = event;
      expected -= 1;
    }
    // A short page must reach game one; never silently label truncated history complete.
    if (events.length < PAGE_SIZE + 1 && expected !== 0) valid = false;
    if (valid) {
      const page = events.slice(0, PAGE_SIZE);
      history = {
        time_control: pool,
        entries: page.map((event) => ({
          game_number: event.games_rated_after,
          date: event.settlement_timestamp,
          result: event.score === 1 ? 'Win' : event.score === 0.5 ? 'Draw' : 'Loss',
          rating: Math.round(event.rating_after),
          change: Math.round(event.rating_after) - Math.round(event.rating_before),
        })),
        next_before_game: events.length > PAGE_SIZE ? page[page.length - 1].games_rated_after : null,
      };
    } else {
      selected.status = 'updating';
      selected.rating = null;
      selected.games_rated = null;
    }
  }
  // Read twice, without taking a lock or delaying any writer.
  const latestConfig = await configRead(entities);
  if (latestConfig?.public_enabled !== true) return hidden(latestConfig ? 'coming_soon' : 'unavailable');
  if (fence(latestConfig) !== fence(config)) return hidden('updating');
  return {
    status: config.processing_enabled === true ? 'ready' : 'paused',
    provisional_games: threshold, generation, pools, history,
  };
}
