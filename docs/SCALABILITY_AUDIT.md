# ChessBet scalability and runtime-efficiency audit

Date: 2026-08-10

## Scope and safety policy

This audit maps active frontend reads, subscriptions, polling, presence writes, backend invocations, entity queries, workflows, and scheduled functions. Changes in this pass are limited to behavior-preserving reductions with an immediate recovery path.

The following paths are protected from speculative optimization:

- server-authoritative game moves and results
- game heartbeat and disconnect telemetry
- official clock calculation and timeout enforcement
- match acceptance, readiness, entry reservation, settlement, and ledger writes
- authentication, jurisdiction checks, identity verification, and MFA
- fair-play analysis, integrity evidence, dispute decisions, and audit records
- integration-event and financial correlation records

No protected decision or money-moving behavior was changed in this pass.

## Implemented optimizations

### Authentication and administration

- The global layout now mounts the admin action alert only for authenticated administrators.
- The alert reuses the authenticated user already loaded by AuthContext instead of calling `auth.me()` every minute.
- Admin action polling pauses while the document is hidden and refreshes immediately on visibility, focus, connectivity, and route changes.
- Integrity-queue display names are requested in one function call rather than one client request per flagged user.

### Presence and marketplace

- General presence heartbeat changed from 20 seconds to 45 seconds.
- Visible/focus/online recovery remains immediate.
- The backend two-minute online window is unchanged.
- Available-match refreshes no longer run in hidden tabs and cannot overlap. They refresh immediately when the player returns or reconnects.
- The Home match-acceptance safety poll changed from two sequential reads every 5 seconds to two parallel reads every 20 seconds in visible tabs only.
- Match realtime subscription remains the primary path, with immediate focus/visibility/online recovery.

### Live game and clock UI

- The authoritative Game realtime subscription and five-second visible safety poll remain in place.
- Hidden tabs no longer issue the Game recovery read every five seconds; they immediately resynchronize when visible, focused, or online.
- Clock server resynchronization remains every five seconds while visible and immediately resynchronizes after visibility, focus, or reconnect.
- The local monotonic clock display and server-only timeout decision remain unchanged.
- The eight-second game heartbeat remains unchanged because its server stale threshold is 20 seconds.

### Player history

- Profile win/loss statistics now read the canonical counters maintained by settlement on the current User record instead of loading all completed platform matches.
- Wallet contest totals remain derived from authoritative completed Match records, but queries are now scoped to the current player in each seat, run in parallel, paginate in 500-record pages, and deduplicate by Match ID.

### Retired active operation

- The layout no longer creates a `SiteVisit` record once per browser session.
- The current admin analytics screen uses `getAnalyticsDashboard`, not `SiteVisit` or the legacy `getSiteActivity` function.
- The historical entity, hook, and diagnostic function are retained for rollback and record continuity; existing records are not deleted.

## Inventory conclusions

### Active and retained

All configured Base44 workflows are active consumers and remain unchanged:

- Match acceptance notification
- Founding-player signup award
- Match settlement
- Five-minute preparation-timeout check

Manual operational functions such as ledger checking, campaign sending, integration-packet export, and founding-player backfill do not consume runtime when idle. They are retained as administrator tools.

### Source files not in the production bundle

The static entry dependency graph identified 47 source modules not reachable from the production frontend entry. These include unused UI primitives, superseded admin pages, an older report dialog, and unused helper modules. Because the bundler excludes them, deleting them would not improve production runtime. They are retained until each product capability and historical route is formally retired.

### Phase-out candidates requiring a separate approval

- `getSiteActivity`: no current frontend or workflow consumer; superseded by `getAnalyticsDashboard`.
- `submitCaseAdditionalInfo`: no current caller; overlaps the active `submitAdditionalInformation` workflow.
- `submitAppeal` and `manageAppeal`: the backend capability exists but no current route or UI consumes it.
- Duplicate IntegrationReference schema source naming: both `IntegrationReference.jsonc` and `integration-reference.jsonc` declare the same entity name. The registered live schema is intact. Source deletion should be performed only through a Base44 environment that supports file deletion and followed immediately by a schema verification.
- Legacy `SiteVisit` hook/entity: active writes are retired, but source and historical records are retained.

These items do not generate runtime load while idle. Removal is therefore a maintenance cleanup, not an urgent performance change.

## Deferred scale work

The following improvements require more design or provider support and were intentionally not mixed into this low-risk pass:

- Replace the wallet transaction IDs-only count query with a server-side count or cursor API.
- Replace large admin analytics scans with time-bounded indexed queries or pre-aggregated daily rollups.
- Batch match, analysis, and user enrichment inside `getAdminActionCenter` after validating Base44 multi-ID query behavior.
- Add load testing and telemetry for request counts, p95 latency, function errors, subscription reconnects, and entity write rates.
- Establish retention policies only after legal, dispute, financial, and audit-record requirements are documented.

## Expected impact

For a normal authenticated user outside a live game, this pass removes the admin request that previously ran once per minute, removes one SiteVisit write per browser session, reduces visible presence writes by about 56%, eliminates hidden-tab marketplace and recovery polling, and reduces the Home safety fallback from 24 Match reads per minute to 6 reads per minute while visible.

For a live game, server-authoritative responsiveness and enforcement remain unchanged; only hidden-tab recovery reads are paused.
