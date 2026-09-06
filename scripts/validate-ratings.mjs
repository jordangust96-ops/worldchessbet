import assert from 'node:assert/strict';
import { updateGlicko2, calculateSequentialGame } from '../base44/shared/glicko2.js';

// Canonical Glicko-2 paper example (three opponents in one rating period).
const canonical = updateGlicko2(
  { rating: 1500, ratingDeviation: 200, volatility: 0.06 },
  [
    { rating: 1400, ratingDeviation: 30, volatility: 0.06, score: 1 },
    { rating: 1550, ratingDeviation: 100, volatility: 0.06, score: 0 },
    { rating: 1700, ratingDeviation: 300, volatility: 0.06, score: 0 },
  ],
  { tau: 0.5 }
);
assert.ok(Math.abs(canonical.rating - 1464.06) < 0.15, `canonical rating ${canonical.rating}`);
assert.ok(Math.abs(canonical.ratingDeviation - 151.52) < 0.15, `canonical RD ${canonical.ratingDeviation}`);
assert.ok(Math.abs(canonical.volatility - 0.059996) < 0.0001, `canonical volatility ${canonical.volatility}`);

// ChessBet's sequential adaptation must be deterministic and symmetric in
// direction for equally rated new players.
const white = calculateSequentialGame(
  { rating: 1500, ratingDeviation: 350, volatility: 0.06 },
  { rating: 1500, ratingDeviation: 350, volatility: 0.06 },
  1,
  { tau: 0.5 }
);
const black = calculateSequentialGame(
  { rating: 1500, ratingDeviation: 350, volatility: 0.06 },
  { rating: 1500, ratingDeviation: 350, volatility: 0.06 },
  0,
  { tau: 0.5 }
);
assert.ok(white.rating > 1500);
assert.ok(black.rating < 1500);
assert.ok(Math.abs((white.rating - 1500) + (black.rating - 1500)) < 0.00001);
assert.equal(
  calculateSequentialGame(
    { rating: 1500, ratingDeviation: 350, volatility: 0.06 },
    { rating: 1500, ratingDeviation: 350, volatility: 0.06 },
    0.5,
    { tau: 0.5 }
  ).rating,
  1500
);

console.log(JSON.stringify({ ok: true, canonical, sequential_equal_players: { white, black } }, null, 2));
