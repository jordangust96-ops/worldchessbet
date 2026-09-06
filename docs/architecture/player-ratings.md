# ChessBet Shadow Player Ratings

## Status

Backend-only shadow architecture. No player-facing rating UI or marketplace dependency is enabled.

Rating epoch: **2026-09-06T16:03:10.000Z**. Contests settled before this timestamp are intentionally excluded so pre-rating test history does not contaminate launch ratings.

## Non-negotiable isolation invariant

Gameplay, game completion, contest settlement, wallets, pending winnings, disputes, fair-play analysis, matchmaking, and challenge creation/acceptance must never depend on ratings.

If the entire rating system is unavailable, ChessBet must continue to operate exactly as it did before ratings existed. Rating work fails closed and remains retryable from durable ContestRecord history.

## Algorithm

- Glicko-2 mathematics, dependency-free implementation in `base44/shared/glicko2.js`.
- ChessBet adaptation: one eligible contest is one sequential rating period.
- Independent pools: `blitz`, `rapid`, `classical`.
- Initial rating: 1500.
- Initial RD: 350.
- Initial volatility: 0.06.
- Tau: 0.5.
- Provisional threshold: 10 rated games. Calculation begins with game 1; the threshold is a future display policy only.
- Algorithm version: `glicko2_sequential_v1`.
- Stockfish/fair-play metrics are never inputs to rating calculation.

## Finality gate

A contest cannot be rated until all of the following are true:

1. Its immutable ContestRecord settled at or after the rating epoch.
2. At least the shared 24-hour contest reporting window has elapsed.
3. Match and Game remain authoritatively completed.
4. There is no unresolved DisputeCase for the match.
5. There is no unresolved match-linked IntegrityFlag (rating is intentionally stricter than payout release).
6. No resolved case has reversed or voided the contest.
7. For a decisive result, the winner's own canonical payout transaction is completed and `payout_hold_status` is `released`.
8. For a draw, there is no payout requirement; the 24-hour/dispute/integrity gates still apply.

The scheduled `Rating Finalization Sweep` runs every 15 minutes. Delay has no data-loss consequence because ContestRecord is the durable backlog.

## Data model

### PlayerRating

Current materialized state for one `user_id + time_control` combination. A player can therefore have up to three independent current rows. Includes rating, RD, volatility, games rated, provisional state, generation, algorithm version, and last-rated contest pointers.

### RatingEvent

Immutable, per-player history. Every rated contest creates two events, one for each participant, containing player/opponent IDs, match/game/ContestRecord IDs, time control, color, result score, before/after rating, before/after RD and volatility, opponent pre-game state, provisional state, generation, timestamps, and algorithm version. This is the future source for profile rating-history charts.

### RatingOperation

Mutable recovery record created before either player's current rating is changed. It snapshots both players' pre-game and calculated post-game state. If a function crashes halfway through, the next sweep verifies whether each side is still at the before state or has already reached the after state and resumes without rating the contest twice.

One deterministic `operation_key` exists per ContestRecord.

### RatingSystemConfig

Singleton admin-only configuration and safety controls. Includes processing/public kill switches, rating epoch, Glicko parameters, provisional threshold, current canonical generation, and rebuild state.

`public_enabled` must remain false until a later UI phase is explicitly authorized.

## Concurrency and failure behavior

A server-only global Redis lease serializes rating mutations. Rating keys use the isolated `chessbet:ratings:v1` prefix and require dedicated `RATING_ATOMIC_REDIS_REST_URL` / `RATING_ATOMIC_REDIS_REST_TOKEN` credentials. Ratings never fall back to ChessBet's financial/Seamless Redis transport.

If the atomic store is unavailable, rating processing performs no writes and retries later. This cannot block or alter financial or gameplay flows.

A temporarily unresolved contest blocks only rating chains that depend on either participant's unresolved rating state; unrelated players can continue processing. The sweep pages the complete ContestRecord backlog with no fixed scan ceiling, while limiting actual rating applications to 25 contests per invocation.

## Reversals / voids after rating

The 24-hour finality gate makes this exceptional, but administrative override remains possible. ChessBet never attempts to mathematically subtract a prior Glicko change.

`Rating Correction On Dispute Resolution` runs only after a DisputeCase resolves as `contest_reversed` or `contest_voided`:

1. Every completed RatingOperation whose match has a resolved reversal/void is excluded from the canonical replay and marked invalidated.
2. Normal rating processing is fail-closed with `rebuild_in_progress`.
3. Any non-completed old-generation operation is marked `superseded_by_rebuild`; after the rebuild it can be safely re-prepared from the new canonical state rather than becoming stranded.
4. A new global rating generation is deterministically replayed from the complete, paginated set of remaining completed RatingOperations in original rating-eligible order.
5. New immutable RatingEvents are written for the new generation.
6. PlayerRating materialized states switch to the new generation only after replay events have been created/verified.
7. A monotonic rebuild request counter fences concurrent reversals/voids. If a newer request arrives during replay, materialization, or final commit, the pipeline keeps the rebuild guard armed and rotates to a fresh generation.
8. If an immutable partial rebuild generation conflicts with a retry, that generation is abandoned rather than overwritten; the retry automatically rotates to a fresh generation.
9. Old RatingEvents remain untouched for audit history.

A failed rebuild leaves `rebuild_in_progress=true`; the scheduled rating sweep attempts to resume the rebuild instead of processing new ratings against uncertain state. Rebuild source reads are fully paginated rather than silently truncated at a fixed row limit.

## UI

No UI was added. Rating entities are admin-only through RLS and no profile/marketplace/gameplay component reads them. A later authorized phase can expose canonical PlayerRating rows and RatingEvent history without changing the calculation path.
