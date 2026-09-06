// Read-only, display-only rating projection for public marketplace cards.
// It never filters, ranks, accepts, creates, or updates matches or ratings.
const VALID_POOLS = new Set(['blitz', 'rapid', 'classical']);
const MAX_PUBLIC_MATCHES = 20;
const STATE_EPSILON = 0.000001;

const keyFor = (userId, timeControl) => JSON.stringify([userId, timeControl]);
const close = (a, b) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) &&
  Math.abs(Number(a) - Number(b)) <= STATE_EPSILON;
const validCount = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0;
const configFence = (config) => JSON.stringify([
  config?.id,
  config?.public_enabled,
  config?.current_generation,
  config?.rebuild_in_progress,
  config?.rebuild_request_counter,
  config?.rebuild_target_generation,
  config?.algorithm_version,
  config?.provisional_games,
]);

async function readConfig(entities) {
  const rows = await entities.RatingSystemConfig.filter(
    { config_key: 'primary' },
    '-created_date',
    2
  );
  return rows.length === 1 ? rows[0] : null;
}

function everyMatch(matches, status) {
  return Object.fromEntries(matches.map((match) => [
    match.id,
    { ratingStatus: status, rating: null },
  ]));
}

export async function readPublicMatchRatings(entities, matches) {
  if (!Array.isArray(matches) || matches.length === 0) return {};
  if (matches.length > MAX_PUBLIC_MATCHES) throw new Error('too_many_public_matches');

  // Defense in depth: this helper only accepts the same public, searching match
  // shape already enforced by publicAvailableMatchQuery.
  const publicMatches = matches.filter((match) =>
    match?.id &&
    match?.player1_id &&
    match?.status === 'searching' &&
    match?.is_private !== true &&
    VALID_POOLS.has(match?.time_control)
  );
  const unavailable = everyMatch(matches, 'unavailable');
  if (publicMatches.length !== matches.length) return unavailable;

  const config = await readConfig(entities);
  if (!config || config.public_enabled !== true) return unavailable;
  if (config.rebuild_in_progress === true || !validCount(config.current_generation)) {
    return everyMatch(matches, 'updating');
  }

  const generation = Number(config.current_generation);
  const threshold = validCount(config.provisional_games) && Number(config.provisional_games) > 0
    ? Number(config.provisional_games)
    : 10;
  const userIds = [...new Set(publicMatches.map((match) => match.player1_id))];
  const timeControls = [...new Set(publicMatches.map((match) => match.time_control))];

  const rows = await entities.PlayerRating.filter({
    user_id: { $in: userIds },
    time_control: { $in: timeControls },
    generation,
  }, '-created_date', Math.min(MAX_PUBLIC_MATCHES * 3 + 1, 100));

  const byKey = new Map();
  const duplicateKeys = new Set();
  for (const row of rows) {
    const key = keyFor(row.user_id, row.time_control);
    if (byKey.has(key)) duplicateKeys.add(key);
    else byKey.set(key, row);
  }

  const candidateRows = publicMatches.map((match) => byKey.get(keyFor(match.player1_id, match.time_control)))
    .filter((row) => row && Number(row.games_rated) > 0);
  const lastGameIds = [...new Set(candidateRows.map((row) => row.last_game_id).filter(Boolean))];

  const events = lastGameIds.length
    ? await entities.RatingEvent.filter({
        user_id: { $in: userIds },
        time_control: { $in: timeControls },
        generation,
        game_id: { $in: lastGameIds },
      }, '-processed_at', Math.min(MAX_PUBLIC_MATCHES * 2 + 1, 100))
    : [];

  const eventByKey = new Map();
  const duplicateEvents = new Set();
  for (const event of events) {
    const key = keyFor(event.user_id, event.time_control);
    const row = byKey.get(key);
    if (!row || event.game_id !== row.last_game_id) continue;
    if (eventByKey.has(key)) duplicateEvents.add(key);
    else eventByKey.set(key, event);
  }

  const operationIds = [...new Set([...eventByKey.values()]
    .map((event) => event.operation_id)
    .filter(Boolean))];
  const operations = operationIds.length
    ? await entities.RatingOperation.filter(
        { id: { $in: operationIds } },
        '-completed_at',
        Math.min(MAX_PUBLIC_MATCHES * 2 + 1, 100)
      )
    : [];
  const operationById = new Map();
  const duplicateOperations = new Set();
  for (const operation of operations) {
    if (operationById.has(operation.id)) duplicateOperations.add(operation.id);
    else operationById.set(operation.id, operation);
  }

  const latestConfig = await readConfig(entities);
  if (!latestConfig || latestConfig.public_enabled !== true) return unavailable;
  if (configFence(latestConfig) !== configFence(config)) {
    return everyMatch(matches, 'updating');
  }

  return Object.fromEntries(publicMatches.map((match) => {
    const key = keyFor(match.player1_id, match.time_control);
    const row = byKey.get(key);

    // A player with no canonical result in this pool is still provisional.
    if (!row) return [match.id, { ratingStatus: 'provisional', rating: null }];
    if (
      duplicateKeys.has(key) ||
      row.generation !== generation ||
      row.algorithm_version !== config.algorithm_version ||
      !validCount(row.games_rated) ||
      !Number.isFinite(Number(row.rating))
    ) {
      return [match.id, { ratingStatus: 'updating', rating: null }];
    }

    const gamesRated = Number(row.games_rated);
    if (gamesRated === 0) {
      return [match.id, { ratingStatus: 'provisional', rating: null }];
    }

    const event = eventByKey.get(key);
    const operation = event?.operation_id ? operationById.get(event.operation_id) : null;
    const eventIsCanonical =
      !!event &&
      !duplicateEvents.has(key) &&
      event.user_id === match.player1_id &&
      event.time_control === match.time_control &&
      event.generation === generation &&
      event.algorithm_version === config.algorithm_version &&
      event.event_type === 'game' &&
      event.game_id === row.last_game_id &&
      Number(event.games_rated_after) === gamesRated &&
      close(event.rating_after, row.rating);
    const operationIsComplete =
      !!operation &&
      !duplicateOperations.has(operation.id) &&
      operation.status === 'completed' &&
      (operation.player1_id === match.player1_id || operation.player2_id === match.player1_id) &&
      operation.game_id === event?.game_id &&
      operation.time_control === match.time_control &&
      (event?.source === 'rebuild' || Number(operation.generation) === generation);

    if (!eventIsCanonical || !operationIsComplete) {
      return [match.id, { ratingStatus: 'updating', rating: null }];
    }
    if (gamesRated < threshold) {
      return [match.id, { ratingStatus: 'provisional', rating: null }];
    }
    return [match.id, { ratingStatus: 'established', rating: Math.round(Number(row.rating)) }];
  }));
}
