import {
  paidContestsEnabled,
  seamlessDepositsEnabled,
  seamlessHostedPlaidEnabled,
  seamlessWithdrawalsEnabled,
} from '../../shared/seamlessFundingConfig.ts';

// Public, read-only production availability. No provider requests, account information,
// configuration details, or secret references are exposed.
Deno.serve(() => Response.json({
  paid_contests_enabled: paidContestsEnabled(),
  deposits_enabled: seamlessDepositsEnabled(),
  withdrawals_enabled: seamlessWithdrawalsEnabled(),
  bank_connection_enabled: seamlessHostedPlaidEnabled(),
}, { headers: { 'Cache-Control': 'no-store' } }));
