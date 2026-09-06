// Pure, dependency-free Glicko-2 implementation for ChessBet ratings.
//
// ChessBet uses one completed contest as one sequential rating period. That is
// an intentional product adaptation: it preserves a deterministic per-game
// history while retaining Glicko-2's rating deviation and volatility model.
// This module is pure math only — no Base44, wallet, gameplay, or network calls.

export const GLICKO2_SCALE = 173.7178;
export const DEFAULT_GLICKO2 = Object.freeze({
  rating: 1500,
  ratingDeviation: 350,
  volatility: 0.06,
  tau: 0.5,
});

const EPSILON = 0.000001;
const PI_SQUARED = Math.PI * Math.PI;

function finiteNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function g(phi) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / PI_SQUARED);
}

function expectation(mu, opponentMu, opponentPhi) {
  return 1 / (1 + Math.exp(-g(opponentPhi) * (mu - opponentMu)));
}

function volatilityPrime(phi, sigma, delta, variance, tau) {
  const a = Math.log(sigma * sigma);
  const deltaSquared = delta * delta;
  const phiSquared = phi * phi;

  const f = (x) => {
    const ex = Math.exp(x);
    const numerator = ex * (deltaSquared - phiSquared - variance - ex);
    const denominator = 2 * Math.pow(phiSquared + variance + ex, 2);
    return numerator / denominator - (x - a) / (tau * tau);
  };

  let A = a;
  let B;
  if (deltaSquared > phiSquared + variance) {
    B = Math.log(deltaSquared - phiSquared - variance);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k += 1;
    B = a - k * tau;
  }

  let fA = f(A);
  let fB = f(B);
  let iterations = 0;
  while (Math.abs(B - A) > EPSILON && iterations < 100) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
    iterations += 1;
  }

  if (iterations >= 100 || !Number.isFinite(A)) {
    throw new Error('Glicko-2 volatility iteration did not converge');
  }
  return Math.exp(A / 2);
}

export function roundRatingNumber(value) {
  if (!Number.isFinite(value)) throw new Error('Non-finite Glicko-2 result');
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function normalizeRatingState(state = {}, defaults = DEFAULT_GLICKO2) {
  const rating = finiteNumber(state.rating, defaults.rating);
  const ratingDeviation = finiteNumber(
    state.ratingDeviation ?? state.rating_deviation,
    defaults.ratingDeviation
  );
  const volatility = finiteNumber(state.volatility, defaults.volatility);
  if (!(ratingDeviation > 0) || !(volatility > 0)) {
    throw new Error('Invalid Glicko-2 state');
  }
  return {
    rating: roundRatingNumber(rating),
    ratingDeviation: roundRatingNumber(ratingDeviation),
    volatility: roundRatingNumber(volatility),
  };
}

// `results` supports a full Glicko-2 rating period, although ChessBet's
// production processor intentionally supplies exactly one opponent/game at a
// time so every settled contest produces its own auditable history point.
export function updateGlicko2(playerState, results, options = {}) {
  const defaults = {
    rating: finiteNumber(options.initialRating, DEFAULT_GLICKO2.rating),
    ratingDeviation: finiteNumber(options.initialRatingDeviation, DEFAULT_GLICKO2.ratingDeviation),
    volatility: finiteNumber(options.initialVolatility, DEFAULT_GLICKO2.volatility),
  };
  const tau = finiteNumber(options.tau, DEFAULT_GLICKO2.tau);
  if (!(tau > 0)) throw new Error('Glicko-2 tau must be positive');

  const player = normalizeRatingState(playerState, defaults);
  if (!Array.isArray(results) || results.length === 0) {
    // No inactivity inflation is applied in ChessBet's sequential-v1 model.
    // Ratings only change from an eligible, final contest result.
    return player;
  }

  const mu = (player.rating - 1500) / GLICKO2_SCALE;
  const phi = player.ratingDeviation / GLICKO2_SCALE;

  let varianceDenominator = 0;
  let improvementSum = 0;

  for (const result of results) {
    const opponent = normalizeRatingState(
      {
        rating: result.rating,
        ratingDeviation: result.ratingDeviation ?? result.rating_deviation,
        volatility: result.volatility ?? defaults.volatility,
      },
      defaults
    );
    const score = Number(result.score);
    if (![0, 0.5, 1].includes(score)) throw new Error('Glicko-2 score must be 0, 0.5, or 1');

    const opponentMu = (opponent.rating - 1500) / GLICKO2_SCALE;
    const opponentPhi = opponent.ratingDeviation / GLICKO2_SCALE;
    const gValue = g(opponentPhi);
    const expected = expectation(mu, opponentMu, opponentPhi);
    varianceDenominator += gValue * gValue * expected * (1 - expected);
    improvementSum += gValue * (score - expected);
  }

  if (!(varianceDenominator > 0) || !Number.isFinite(varianceDenominator)) {
    throw new Error('Invalid Glicko-2 variance');
  }

  const variance = 1 / varianceDenominator;
  const delta = variance * improvementSum;
  const newVolatility = volatilityPrime(phi, player.volatility, delta, variance, tau);
  const preRatingPhi = Math.sqrt(phi * phi + newVolatility * newVolatility);
  const newPhi = 1 / Math.sqrt(1 / (preRatingPhi * preRatingPhi) + 1 / variance);
  const newMu = mu + newPhi * newPhi * improvementSum;

  return {
    rating: roundRatingNumber(1500 + GLICKO2_SCALE * newMu),
    ratingDeviation: roundRatingNumber(GLICKO2_SCALE * newPhi),
    volatility: roundRatingNumber(newVolatility),
  };
}

export function calculateSequentialGame(playerState, opponentState, score, options = {}) {
  return updateGlicko2(playerState, [{
    rating: opponentState.rating,
    ratingDeviation: opponentState.ratingDeviation ?? opponentState.rating_deviation,
    volatility: opponentState.volatility,
    score,
  }], options);
}
