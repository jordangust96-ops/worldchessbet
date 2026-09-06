import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readPublicMatchRatings } from '../base44/shared/publicMatchRatings.js';

let assertions = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const match = (overrides = {}) => ({
  id: 'match-1',
  player1_id: 'host-1',
  time_control: 'rapid',
  status: 'searching',
  is_private: false,
  ...overrides,
});

function fixture({ games = null, rating = 1543.6, generation = 2, source = 'normal' } = {}) {
  const tables = {
    RatingSystemConfig: [{
      id: 'config',
      config_key: 'primary',
      public_enabled: true,
      current_generation: generation,
      rebuild_in_progress: false,
      rebuild_request_counter: 0,
      rebuild_target_generation: generation,
      algorithm_version: 'glicko2_sequential_v1',
      provisional_games: 10,
    }],
    PlayerRating: [],
    RatingEvent: [],
    RatingOperation: [],
  };
  if (games != null) {
    tables.PlayerRating.push({
      id: 'rating-1',
      user_id: 'host-1',
      time_control: 'rapid',
      generation,
      algorithm_version: 'glicko2_sequential_v1',
      games_rated: games,
      rating,
      last_game_id: games > 0 ? 'game-last' : '',
    });
  }
  if (games > 0) {
    tables.RatingEvent.push({
      id: 'event-1',
      operation_id: 'operation-1',
      event_type: 'game',
      source,
      user_id: 'host-1',
      time_control: 'rapid',
      generation,
      algorithm_version: 'glicko2_sequential_v1',
      game_id: 'game-last',
      games_rated_after: games,
      rating_after: rating,
    });
    tables.RatingOperation.push({
      id: 'operation-1',
      status: 'completed',
      generation: source === 'rebuild' ? generation - 1 : generation,
      player1_id: 'host-1',
      player2_id: 'other',
      time_control: 'rapid',
      game_id: 'game-last',
    });
  }

  const calls = [];
  let configReads = 0;
  const state = { tables, calls, onConfigRead: null, entities: null };
  const matches = (row, query) => Object.entries(query).every(([key, value]) => {
    if (value && typeof value === 'object' && '$in' in value) return value.$in.includes(row[key]);
    return row[key] === value;
  });
  state.entities = Object.fromEntries(Object.keys(tables).map((name) => [name, {
    async filter(query, sort, limit) {
      calls.push({ name, query, sort, limit });
      assert.ok(limit > 0 && limit <= 100);
      if (name === 'RatingSystemConfig') {
        configReads += 1;
        state.onConfigRead?.(configReads);
      }
      return structuredClone(tables[name].filter((row) => matches(row, query)).slice(0, limit));
    },
    create() { throw new Error('WRITE FORBIDDEN'); },
    update() { throw new Error('WRITE FORBIDDEN'); },
    delete() { throw new Error('WRITE FORBIDDEN'); },
  }]));
  return state;
}

check(await readPublicMatchRatings(fixture().entities, []), {});

let f = fixture();
let result = await readPublicMatchRatings(f.entities, [match()]);
check(result['match-1'], { ratingStatus: 'provisional', rating: null });
check(f.calls.filter((call) => call.name === 'RatingEvent').length, 0);

for (const games of [0, 1, 9]) {
  f = fixture({ games });
  result = await readPublicMatchRatings(f.entities, [match()]);
  check(result['match-1'], { ratingStatus: 'provisional', rating: null });
}

f = fixture({ games: 10 });
result = await readPublicMatchRatings(f.entities, [match()]);
check(result['match-1'], { ratingStatus: 'established', rating: 1544 });
check(Object.keys(result['match-1']).sort(), ['rating', 'ratingStatus']);
check(JSON.stringify(result).includes('host-1'), false);
check(JSON.stringify(result).includes('game-last'), false);

f = fixture({ games: 25, source: 'rebuild' });
check((await readPublicMatchRatings(f.entities, [match()]))['match-1'].ratingStatus, 'established');

f = fixture({ games: 10 });
f.tables.RatingSystemConfig[0].public_enabled = false;
result = await readPublicMatchRatings(f.entities, [match()]);
check(result['match-1'], { ratingStatus: 'unavailable', rating: null });
check(f.calls.map((call) => call.name), ['RatingSystemConfig']);

f = fixture({ games: 10 });
f.tables.RatingSystemConfig[0].rebuild_in_progress = true;
result = await readPublicMatchRatings(f.entities, [match()]);
check(result['match-1'], { ratingStatus: 'updating', rating: null });
check(f.calls.map((call) => call.name), ['RatingSystemConfig']);

for (const mutate of [
  (state) => state.tables.PlayerRating.push({ ...state.tables.PlayerRating[0], id: 'duplicate' }),
  (state) => { state.tables.PlayerRating[0].algorithm_version = 'other'; },
  (state) => { state.tables.PlayerRating[0].rating = Number.NaN; },
  (state) => { state.tables.RatingEvent[0].rating_after += 1; },
  (state) => { state.tables.RatingEvent[0].games_rated_after += 1; },
  (state) => { state.tables.RatingEvent[0].game_id = 'wrong-game'; },
  (state) => { state.tables.RatingEvent.push({ ...state.tables.RatingEvent[0], id: 'duplicate-event' }); },
  (state) => { state.tables.RatingOperation[0].status = 'applying'; },
  (state) => { state.tables.RatingOperation[0].player1_id = 'someone-else'; },
  (state) => { state.tables.RatingOperation[0].generation = 99; },
]) {
  f = fixture({ games: 10 });
  mutate(f);
  result = await readPublicMatchRatings(f.entities, [match()]);
  check(result['match-1'], { ratingStatus: 'updating', rating: null });
}

for (const invalid of [
  match({ is_private: true }),
  match({ status: 'preparing' }),
  match({ time_control: 'bullet' }),
  match({ player1_id: '' }),
]) {
  f = fixture({ games: 10 });
  result = await readPublicMatchRatings(f.entities, [invalid]);
  check(result['match-1'], { ratingStatus: 'unavailable', rating: null });
  check(f.calls.length, 0);
}

for (const change of [
  (config) => { config.public_enabled = false; },
  (config) => { config.current_generation += 1; },
  (config) => { config.rebuild_request_counter += 1; },
  (config) => { config.rebuild_in_progress = true; },
]) {
  f = fixture({ games: 10 });
  f.onConfigRead = (read) => { if (read === 2) change(f.tables.RatingSystemConfig[0]); };
  result = await readPublicMatchRatings(f.entities, [match()]);
  check(result['match-1'].rating, null);
  check(['unavailable', 'updating'].includes(result['match-1'].ratingStatus), true);
}

f = fixture({ games: 10 });
const two = match({ id: 'match-2', time_control: 'blitz' });
result = await readPublicMatchRatings(f.entities, [match(), two]);
check(result['match-1'].ratingStatus, 'established');
check(result['match-2'].ratingStatus, 'provisional');
const playerQuery = f.calls.find((call) => call.name === 'PlayerRating').query;
check(playerQuery.user_id, { $in: ['host-1'] });
check(playerQuery.time_control, { $in: ['rapid', 'blitz'] });

// Source-level isolation: presentation reads may add fields to existing public
// matches, but cannot affect marketplace selection, ordering, or acceptance.
const read = (path) => fs.readFileSync(path, 'utf8');
const helper = read('base44/shared/publicMatchRatings.js');
const endpoint = read('base44/functions/getAvailableMatches/entry.ts');
const card = read('src/components/play/AvailableMatchSection.jsx');
const query = read('base44/shared/marketplaceStats.ts');
const accept = read('base44/functions/acceptMatch/entry.ts');
const create = read('base44/functions/createMatch/entry.ts');

assert.doesNotMatch(helper, /\.(create|update|delete|bulkCreate|invoke)\s*\(/);
assert.doesNotMatch(endpoint, /\.(create|update|delete|bulkCreate|invoke)\s*\(/);
assert.doesNotMatch(card, /base44\.entities\.(PlayerRating|RatingEvent|RatingOperation|RatingSystemConfig)|asServiceRole/);
assert.match(card, /Rating:\{" "\}/);
assert.match(card, /current\.gamesPlayed/);
assert.match(card, /current\.winPercentage/);
assert.match(query, /status: 'searching'/);
assert.match(query, /is_private: \{ \$ne: true \}/);
assert.doesNotMatch(query, /rating/i);
assert.doesNotMatch(accept + create, /PlayerRating|RatingEvent|RatingOperation|publicMatchRatings|ratingStatus/i);
assert.match(endpoint, /readPublicMatchRatings\(base44\.asServiceRole\.entities, available\)/);
assert.match(endpoint, /\.catch\(\(\) => unavailableRatings\)/);
assert.match(endpoint, /available\.map\(\(match, index\)/);

console.log('Public match rating privacy, canonicality, fallback, and isolation: ' + assertions + ' assertions passed.');
