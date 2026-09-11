# Pending winnings release hardening

The five-minute `releasePendingWinnings` workflow is the sole writer that releases automatic match winnings. Clearing integrity flags and resolving cases no longer directly release payouts. An investigation that adopted a pending payout cannot use `release_hold` to bypass the review deadline.

Release requires a completed, held payout; a valid payout release timestamp; a permanent ContestRecord settlement timestamp; both the payout deadline and settlement + 24 hours to have elapsed; and no open case or qualifying Fair Play/settlement flag. Eligibility and the release-status update execute inside the global ledger lock. The original `pending_winnings_auto_release:<transaction>:release` journal identifier is preserved for retry deduplication. Release preserves the payout's original settlement metadata.

The sweep collects every due page before changing statuses and continues past an individual posting error, returning failedIds for diagnosis. User/system balance reconstruction and journal recovery now paginate their full histories. The wallet page refreshes canonical balances every 15 seconds while visible and on focus/visibility return.

Available increases and Held decreases by the same payout amount. Total Balance includes held funds and does not increase a second time at release. Match settlement/release remains internal accounting; it does not initiate a Seamless payment.

Validation: actual backend code with simulated entities covers 501 due payouts plus 200 future payouts, deadline/report-window alignment, missing settlement evidence, new review blockers at lock acquisition, interrupted status writes, overlapping sweeps, user/system histories beyond 5,000 entries, and admin case/flag actions. Existing ledger, settlement, dispute traceability, deterministic group IDs, and Seamless checks pass; build and lint pass. No live funds were moved for testing. Runtime scheduler delivery and provider cash coverage were not established by these isolated tests.
