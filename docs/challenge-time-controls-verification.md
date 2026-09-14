# Challenge time controls — September 14, 2026

Removed the redundant winner-award sentence from challenge creation. Restored the existing ChessBet choices: Blitz 3+0, Rapid 10+0, Classical 15+0. The selection is included in creation retry identity and validated server-side; the server snapshots its own label and clock. Shared preview, challenge list, readiness and rematch creation use the selected format. Existing five-minute invitations and older clients omitting timeControl retain five-minute clocks. Game creation uses the saved, validated clock; resuming does not reset clocks.

Financial reservation, eligibility, cancellation/refund, readiness windows and settlement rules are unchanged.

Verification:
- Challenge lifecycle: 878 assertions passed, running the actual lifecycle and journal code with isolated storage, locks and providers across all three controls and legacy five-minute invitations.
- All 24 package test suites passed, including payments, identity, jurisdiction, match start, gameplay, settlement, held winnings and ratings. The match-location harness now imports the real pure challenge policy dependency.
- Browser QA: 10 scenarios / 55 checks passed, including all three selection/create/preview paths, anonymous preview/signup, pending funds refusal, funded acceptance, explicit readiness and closed invitations. Backend calls were mocked and outbound service requests blocked.
- Production build and prerender passed. Targeted frontend lint had zero errors and one existing unused-disable warning in SettlementState. Full change diff whitespace check passed against 58fb19b.
- Public site still served /assets/index-Cq-vElDi.js during verification. Frontend publication remains outstanding.
- Live unauthenticated manageChallenge request returned 401 login_required. getOrCreateGame rejected an unauthenticated request with its existing authentication error (HTTP 500); this is not evidence of a successful authenticated game-start check.

No real deposits, withdrawals, paid test games, customer messages, balance adjustments or policy flag changes were made. A live funded two-player end-to-end match was not performed.
