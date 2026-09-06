import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { readMyRating } from '../base44/shared/myRatingRead.js';

let assertions = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
function fixture(count = 0, generation = 0) {
  const tables = {
    RatingSystemConfig: [{ id: 'config', config_key: 'primary', public_enabled: true,
      processing_enabled: true, current_generation: generation, provisional_games: 10,
      algorithm_version: 'glicko2_sequential_v1', rebuild_in_progress: false, rebuild_request_counter: 0 }],
    PlayerRating: [], RatingEvent: [], RatingOperation: [],
  };
  for (let n = 1; n <= count; n++) {
    tables.RatingEvent.push({
      id: 'event-' + n, operation_id: 'op-' + n, user_id: 'me', opponent_user_id: 'private-opponent',
      time_control: 'blitz', generation, event_type: 'game', source: generation ? 'rebuild' : 'normal',
      algorithm_version: 'glicko2_sequential_v1', games_rated_before: n - 1, games_rated_after: n,
      game_id: 'game-' + n, score: 1, rating_before: 1500 + n - 1, rating_after: 1500 + n,
      settlement_timestamp: '2026-09-06T16:00:00Z', description: 'private internal diagnostic',
    });
    tables.RatingOperation.push({ id: 'op-' + n, status: 'completed', generation: 0,
      player1_id: 'me', player2_id: 'private-opponent', game_id: 'game-' + n, time_control: 'blitz' });
  }
  if (count) tables.PlayerRating.push({
    user_id: 'me', time_control: 'blitz', generation, algorithm_version: 'glicko2_sequential_v1',
    games_rated: count, rating: 1500 + count, last_game_id: 'game-' + count,
  });
  // Other players' rows must never influence or appear in this projection.
  tables.PlayerRating.push({ user_id: 'other', time_control: 'blitz', generation, rating: 9999 });
  tables.RatingEvent.push({ user_id: 'other', time_control: 'blitz', generation, games_rated_after: 9999 });
  const calls = [];
  let configReads = 0;
  const state = { tables, calls, onConfigRead: null, entities: null };
  state.entities = Object.fromEntries(Object.keys(tables).map((name) => [name, {
    async filter(query, sort, limit) {
      calls.push({ name, query, limit });
      assert.ok(limit > 0 && limit <= 21);
      if (name === 'RatingSystemConfig') {
        configReads++;
        state.onConfigRead?.(configReads);
      }
      let rows = tables[name].filter((row) => Object.entries(query).every(([key, value]) =>
        value && typeof value === 'object' ? row[key] < value.$lt : row[key] === value));
      const descending = sort.startsWith('-');
      const key = descending ? sort.slice(1) : sort;
      rows = [...rows].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (descending ? -1 : 1));
      return structuredClone(rows.slice(0, limit));
    },
    create() { throw new Error('WRITE FORBIDDEN'); },
    update() { throw new Error('WRITE FORBIDDEN'); },
    delete() { throw new Error('WRITE FORBIDDEN'); },
  }]));
  return state;
}
let f = fixture(46);
let result = await readMyRating(f.entities, 'me');
check(result.pools[0].status, 'established');
check(result.pools[0].rating, 1546);
check(result.history.entries.map((e) => e.game_number), Array.from({ length: 20 }, (_, i) => 46 - i));
check(result.history.next_before_game, 27);
let second = await readMyRating(f.entities, 'me', { time_control: 'blitz', before_game: 27, generation: 0 });
check(second.history.entries[0].game_number, 26);
let third = await readMyRating(f.entities, 'me', { before_game: second.history.next_before_game, generation: 0 });
check(third.history.entries.map((e) => e.game_number), [6, 5, 4, 3, 2, 1]);
check(third.history.next_before_game, null);
check(JSON.stringify(result).includes('private'), false);
check(JSON.stringify(result).includes('9999'), false);
for (const call of f.calls.filter((c) => ['PlayerRating', 'RatingEvent'].includes(c.name))) check(call.query.user_id, 'me');
for (const n of [0, 1, 9, 10]) {
  f = fixture(n);
  result = await readMyRating(f.entities, 'me');
  check(result.pools[0].status, n === 0 ? 'unrated' : n < 10 ? 'provisional' : 'established');
  check(result.pools[1].status, 'unrated');
  if (n === 0) check(result.pools[0].rating, null);
}
f = fixture(1, 3);
check((await readMyRating(f.entities, 'me')).history.entries.length, 1);
check((await readMyRating(f.entities, 'me', { before_game: 1, generation: 2 })).status, 'updating');

for (const mutation of [
  (t) => { t.RatingOperation[0].status = 'applying'; },
  (t) => { t.RatingOperation[0].status = 'invalidated'; },
  (t) => { t.PlayerRating[0].generation = 99; },
  (t) => { t.PlayerRating.push({ ...t.PlayerRating[0] }); },
  (t) => { t.RatingEvent.unshift({ ...t.RatingEvent[0] }); },
  (t) => { t.RatingEvent[0].rating_after = 42; },
  (t) => { t.RatingEvent[0].games_rated_after = 2; },
  (t) => { t.RatingEvent[0].user_id = 'other'; },
  (t) => { t.RatingOperation[0].player1_id = 'other'; },
  (t) => { t.RatingOperation[0].generation = 99; },
]) {
  f = fixture(1); mutation(f.tables);
  result = await readMyRating(f.entities, 'me');
  check(result.pools[0].status, 'updating');
  check(result.pools[0].rating, null);
  check(result.history, null);
}
f = fixture(30);
f.tables.RatingEvent = f.tables.RatingEvent.filter((e) => e.games_rated_after !== 15);
check((await readMyRating(f.entities, 'me')).history, null);
f = fixture(3);
f.tables.RatingSystemConfig[0].public_enabled = false;
result = await readMyRating(f.entities, 'me');
check(result.status, 'coming_soon');
check(result.pools[0].games_rated, null);
check(f.calls.map((c) => c.name), ['RatingSystemConfig']);
f = fixture(1); f.tables.RatingSystemConfig[0].rebuild_in_progress = true;
check((await readMyRating(f.entities, 'me')).status, 'updating');
check(f.calls.length, 1);
for (const change of [
  (c) => { c.public_enabled = false; },
  (c) => { c.current_generation++; },
  (c) => { c.rebuild_request_counter++; },
  (c) => { c.rebuild_in_progress = true; },
]) {
  f = fixture(2);
  f.onConfigRead = (n) => { if (n === 2) change(f.tables.RatingSystemConfig[0]); };
  result = await readMyRating(f.entities, 'me');
  check(result.history, null);
  check(result.pools[0].rating, null);
}
f = fixture(1); f.tables.RatingSystemConfig[0].processing_enabled = false;
check((await readMyRating(f.entities, 'me')).status, 'paused');
f = fixture(); f.tables.RatingSystemConfig = [];
check((await readMyRating(f.entities, 'me')).status, 'unavailable');
for (const input of [{ time_control: 'bullet' }, { before_game: -1 }, { before_game: '5' }, { generation: 1.5 }]) {
  await assert.rejects(readMyRating(fixture().entities, 'me', input), /invalid_request/); assertions++;
}
await assert.rejects(readMyRating(fixture().entities, '', {}), /authentication_required/); assertions++;

// Execute the actual endpoint with a fake authenticated SDK and read-only fixtures.
// No network access or live records are involved.
const entry = fs.readFileSync('base44/functions/getMyRating/entry.ts', 'utf8');
let handler;
let authUser = { id: 'me' };
f = fixture(1);
const compiled = ts.transpileModule(entry.replace(/^import .*;\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
vm.runInNewContext(compiled, {
  Deno: { serve: (fn) => { handler = fn; } }, Response,
  createClientFromRequest: () => ({ auth: { me: async () => authUser }, asServiceRole: { entities: f.entities } }),
  readMyRating,
});
const request = (body, method = 'POST') => new Request('https://example.test', {
  method, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
});
check((await handler(request({ user_id: 'other' }))).status, 400);
check((await handler(request({}, 'GET'))).status, 405);
authUser = null;
const callsBefore = f.calls.length;
check((await handler(request({}))).status, 401);
check(f.calls.length, callsBefore);
authUser = { id: 'me' };
const response = await handler(request({}));
check(response.status, 200);
check(response.headers.get('cache-control'), 'private, no-store');
check((await response.json()).pools[0].rating, 1501);

// Read-side isolation is enforced across the whole source tree.
const read = (path) => fs.readFileSync(path, 'utf8');
const projection = read('base44/shared/myRatingRead.js');
assert.doesNotMatch(projection + entry, /\.(create|update|delete|bulkCreate|invoke)\s*\(|ratingAtomicStore|ratingPolicy|processEligibleRatings|rebuildAllRatings/);
const ui = read('src/components/profile/MyRatingSection.jsx');
assert.doesNotMatch(ui, /\.entities\.|asServiceRole|processEligibleRatings|rebuildAllRatings/);
check([...ui.matchAll(/functions\.invoke\("([^"]+)"/g)].map((m) => m[1]), ['getMyRating']);
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = directory + '/' + entry.name;
    return entry.isDirectory() ? files(path) : [path];
  });
}
const terms = /PlayerRating|RatingEvent|RatingOperation|RatingSystemConfig|processEligibleRatings|rebuildAllRatings|getMyRating|myRatingRead|ratingPolicy|ratingAtomicStore|glicko2|MyRatingSection/;
for (const path of files('base44/functions').filter((p) =>
  !/^base44\/functions\/(processEligibleRatings|rebuildAllRatings|getMyRating|getAvailableMatches)\//.test(p))) {
  assert.doesNotMatch(read(path), terms, path);
}
for (const path of files('src').filter((p) => /\.(jsx?|tsx?)$/.test(p) &&
  !['src/pages/Profile.jsx', 'src/components/profile/MyRatingSection.jsx'].includes(p))) {
  assert.doesNotMatch(read(path), terms, path);
}
console.log('My Rating privacy, canonical history, pagination, auth, failure isolation: ' + assertions + ' assertions passed.');
await import('./validate-public-match-ratings.mjs');
