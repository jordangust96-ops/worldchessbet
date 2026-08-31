# Checkpoint: Before jurisdiction interest waitlist

Created: 2026-08-31 (America/Detroit)
Baseline commit: `46f2256` — "Refactor jurisdiction gate validation script and add exhaustive test coverage"
Working tree: clean (no uncommitted changes at capture time)

State captured immediately before any work on a **jurisdiction interest waitlist**
feature (letting users in not-yet-approved states register interest and be
notified when their state goes live). No app files, data, secrets, workflows,
or settings were modified to produce this checkpoint.

## Baseline reference

- HEAD: `46f2256cd8b9a36e8385849d341774a844f6341c`
- Recent log:
  `46f2256` Refactor jurisdiction gate validation script and add exhaustive test coverage
  `f15e396` Use relative path for jurisdictionConfig import
  `e04deb6` Refactor route nesting and add jurisdiction access guard
  `0739ddf` Add JurisdictionAccessGuard component for location-based route protection
  `3a85816` Implement jurisdiction access evaluation logic

## Current jurisdiction state

- Approved-jurisdiction allowlist (Tier 1, 10 states), authoritative server-side:
  `AR CO GA IA KS ND TX VA WI WY`.
  - Frontend mirror: `src/lib/jurisdictionConfig.js` (`APPROVED_STATES`,
    `EFFECTIVE_APPROVED_STATES = APPROVED_STATES`, `getJurisdictionMessage`).
  - Server enforcement: `base44/functions/getCurrentJurisdiction/entry.ts`
    (`APPROVED_STATES`); pure gates in `base44/shared/jurisdictionGates.js`.
- Authenticated access guard: `src/components/JurisdictionAccessGuard.jsx`
  (layout route nested after `ProtectedRoute`, before `MfaGuard` in
  `src/AuthenticatedApplication.jsx`).
  - Invokes `base44.functions.invoke("getCurrentJurisdiction", { triggerEvent: "app_access" })`
    once per user id, deduped via `getJurisdictionCheck` in
    `src/lib/jurisdictionAccess.js`.
  - Decision: `evaluateJurisdictionAccess(result?.data ?? result)` → `{ allowed, reason }`.
  - Allowed → `<Outlet />`. Blocked → `<UnavailableScreen>` (full-screen):
    `ShieldAlert` icon, `APPROVED_STATES.join(", ")` list, **Sign out** button,
    and FAQ / Terms / Privacy footer links. **No "notify me" / waitlist CTA exists today.**
  - No retry, no timer, no focus/visibility listener, no localStorage/sessionStorage;
  any rejection fails closed (`allowed:false`).
- `getCurrentJurisdiction` response fields available to the guard (from the
  existing `JurisdictionVerificationLog` schema + entry.ts contract): `status`
  (`approved` | `blocked` | `unknown` | `verification_failed`), `approved`,
  `country`, `state`, `reason`, plus `enforcementEnabled` surfaced by the
  guard's evaluator. Guard itself only consumes `allowed`/`reason`.

## No existing waitlist/interest entity

- Closest existing grow-notify entity: `base44/entities/LaunchNotification.jsonc`
  (`email` required; `user_id` optional; `username`; `submitted_at`).
  - RLS: `create: true` (any visitor), `read/update/delete: { role: "admin" }`.
  - This is a public launch-day notify-me list, **not** a per-state interest
  waitlist. It has no `state`, `jurisdiction_status`, or delivery/fulfillment
  status fields, and no per-user dedup key beyond email.

## Established email-sending pattern to mirror

- SendEmail API (both senders):
  `await base44.asServiceRole.integrations.Core.SendEmail({ to, subject, body: html, from_name: 'ChessBet' })`.
  - Senders: `base44/functions/sendWelcomeEmail/entry.ts`,
    `base44/functions/sendPromotionalCampaign/entry.ts`.
- Branded template: `buildChessBetEmailHtml({ appUrl, headerTitle, headerSubtitle,
  bodyHtml, ctaText, ctaUrl, earlyAccessText, supportEmail })` defined inline in
  `sendWelcomeEmail`. Gold `#C9A84C`, dark `#0A0A0A` card, Inter stack, CTA pill,
  footer links `${appUrl}/privacy-policy` and `${appUrl}/terms-of-service`.
  Note to self on copy-paste: keep this helper duplicated per function (Deno
  functions deploy independently; no shared import) if a waitlist email is added.
- App URL: `Deno.env.get('APP_URL')` (secret `APP_URL` exists). Published app:
  `https://chessbetv1.base44.app`. Use custom domain for user-clicked links if one
  is connected (not currently).
- Support email: read from the active `PrivacyPolicyConfig.record.support_email`
  (`sendWelcomeEmail` lines 85-86); platform preference is `hello@worldchessbet.com`
  as the sole public-facing contact.
- Idempotency/delivery patterns to mirror for a waitlist notify-on-launch sender:
  - `sendWelcomeEmail`: account-scoped guard (`user.welcome_email_sent`) +
    `EmailLog` (`email_type`, status `success`/`failed`, `error_message`).
  - `sendPromotionalCampaign`: per-recipient dedup via `CampaignDelivery`
    (`campaign_key` + `user_id`, status `sending|success|failed`, `sent_at`,
    `error_message`) + append-only `CampaignEmailLog`; closed accounts excluded.
  - Recommend a per-state campaign model: unique `campaign_key` per state
    (e.g. `jurisdiction_launch:NY`) reusing the `CampaignDelivery`/`CampaignEmailLog`
    shape, driven by a scheduled workflow (see below), so re-runs never double-send.

## RLS / delivery-status patterns already in app (reuse, don't reinvent)

- User-owned RLS: `Wallet` (`read: { "data.user_id": "{{user.id}}" }`),
  `SeamlessBankAccount`/`SeamlessPaymentProfile` (owner read, admin write),
  `LedgerEntry` (`$or` owner or admin), `JurisdictionVerificationLog`
  (`$or` owner or admin).
- Admin-only aggregate access: `CampaignDelivery`, `CampaignEmailLog`,
  `CampaignRun`, `EmailLog`, `DailyOperationsBrief`, `OperationsFinding`,
  `IntegrationEvent`, `IntegrationReference` — all `read/update/create: { role:"admin" }`.
- Delivery-status fields (enum + error + timestamp): `CampaignDelivery`
  (`status` `sending|success|failed`, `error_message`, `sent_at`),
  `IntegrationEvent.outbox` (`delivery_state` `unconfigured|pending|delivered|
  failed|ignored`, `delivery_attempts`, `last_delivery_at`, `last_delivery_error`),
  `EmailLog` (`status` `success|failed`, `error_message`).

## Workflows (scheduled-job format in this app)

- Checked-in workflows (`base44/workflows/*.jsonc`):
  `DailyOperationsBriefing`, `FoundingPlayerOnSignup`, `MatchAcceptanceNotification`,
  `MatchSettlement`, `PostSettlementIntegrity`, `PreparationTimeout`,
  `SettlementRecovery`.
- Recurring scheduled pattern: `DailyOperationsBriefing` uses a `scheduled`
  trigger calling `invoke_backend_function` → `generateDailyOperationsBrief`.
  A jurisdiction-launch waitlist notifier should follow the same shape:
  `scheduled` trigger → `invoke_backend_function` → a new
  `sendJurisdictionLaunchNotifications` (or reuse `sendPromotionalCampaign` with
  a state-scoped `campaignKey`).

## Country / state list dependency

- `package.json` has **no** country/state dataset dependency (no `countries-list`,
  no `world-countries`, no `usa-states`). Installed location libs are map-only
  (`react-leaflet`, `leaflet` transitive).
- Smallest dependency-free approach (matches the existing `APPROVED_STATES`
  convention): a new `src/lib/jurisdictionRegions.js` exporting constant arrays
  — a U.S. state list as USPS 2-letter codes + names (50 + DC), already aligned
  with the 2-letter codes used by `APPROVED_STATES`. No npm install needed.

## Backend-function capability / limitations visible at baseline

- No plan/capability limitation currently blocks functions or scheduled email:
  `sendWelcomeEmail` and `sendPromotionalCampaign` deploy and call `Core.SendEmail`;
  scheduled workflows exist and invoke backend functions
  (`DailyOperationsBriefing` → `generateDailyOperationsBrief`).
- Payment/deposit/withdrawal backend functions still fail closed on
  `EARLY_ACCESS_MODE = true` (`base44/functions/submitSeamlessDeposit/entry.ts`,
  `submitSeamlessWithdrawal`, `depositFunds`). Unchanged by waitlist work.
- Jurisdiction enforcement is live (secrets `MAXMIND_GEOIP_ENABLED` and
  `MAXMIND_ADMIN_FORCE_LIVE_CHECKS` exist; `EARLY_ACCESS_MODE` remains `true` but
  no longer bypasses geolocation — see prior checkpoint
  `before-authenticated-maxmind-access-enforcement.md`).

## Proposed minimal change set (for the upcoming waitlist work — not applied here)

1. New entity `JurisdictionInterest` (or extend `LaunchNotification`): fields
   `email`, `user_id?`, `username?`, `requested_state` (USPS 2-letter),
   `jurisdiction_status_at_signup?` (`approved|blocked|unknown|verification_failed`),
   `submitted_at`, optional `notified_at`. RLS: `create: true` (public/authed),
   `read/update/delete: { role:"admin" }`. Dedup on `email` (+ `requested_state`
   if multi-state allowed).
2. `src/components/JurisdictionWaitlistCard.jsx` — a focused component rendering
   an email + state form, shown inside `JurisdictionAccessGuard`'s
   `<UnavailableScreen>` (the single existing blocked-surface touch-point).
   No other pages/logic changed.
3. Backend function `submitJurisdictionInterest/entry.ts` — validate, dedup,
   create `JurisdictionInterest`; reuse `LaunchNotification`-style RLS.
4. Workflow `JurisdictionLaunchNotification.jsonc` (optional, launch-time):
   `scheduled` trigger → `invoke_backend_function` → a per-state notification
   sender mirroring `sendPromotionalCampaign`'s `CampaignDelivery`/
   `CampaignEmailLog` idempotency with a state-scoped `campaignKey`.
5. No `package.json` change (inline USPS state list, no new dependency).

## Rollback

Nothing to roll back — this checkpoint creates only this document. The
feature work listed above is proposed, not applied.