import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import {
  seamlessProviderApproved,
  paidContestsEnabled,
  seamlessDepositsEnabled,
  seamlessHostedPlaidEnabled,
  seamlessWithdrawalsEnabled,
} from '../../shared/seamlessFundingConfig.ts';
import { isSeamlessPlaidVerified } from '../../shared/identityEligibility.js';
import { legalNameFromUser } from '../../shared/legalName.ts';

// Read-only wallet funding view. Provider verification status is read only
// from webhook-maintained SeamlessBankAccount records; the browser callback
// never makes a bank usable.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const profile = (
      await base44.asServiceRole.entities.SeamlessPaymentProfile.filter({ user_id: user.id })
    )[0] || null;
    const banks = await base44.asServiceRole.entities.SeamlessBankAccount.filter(
      { user_id: user.id }, '-added_at', 50
    );

    const [deposits, withdrawals, completedDeposits] = await Promise.all([
      base44.asServiceRole.entities.WalletTransaction.filter(
        { launch_epoch: 2, user_id: user.id, type: 'deposit' }, '-created_date', 10
      ),
      base44.asServiceRole.entities.WalletTransaction.filter(
        { launch_epoch: 2, user_id: user.id, type: 'withdrawal' }, '-created_date', 10
      ),
      base44.asServiceRole.entities.WalletTransaction.filter(
        { launch_epoch: 2, user_id: user.id, type: 'deposit', status: 'completed' }, '-created_date', 1
      ),
    ]);
    const recent = [...deposits, ...withdrawals]
      .sort((a, b) => new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime())
      .slice(0, 10);
    const visibleBanks = banks.filter((bank) => bank.status !== 'deleted');

    return Response.json({
      enabled: true,
      provider_approved: seamlessProviderApproved(),
      paid_contests_enabled: paidContestsEnabled(),
      deposits_enabled: seamlessDepositsEnabled(),
      withdrawals_enabled: seamlessWithdrawalsEnabled(),
      hosted_plaid_enabled: seamlessHostedPlaidEnabled(),
      has_completed_deposit: completedDeposits.length > 0,
      account_verified: isSeamlessPlaidVerified(user),
      legal_name: legalNameFromUser(user)?.fullName || '',
      verification_status: user.identity_verification_status || 'not_started',
      account_state: user.account_state || 'provisional',
      withdrawal_hold: !!user.withdrawal_hold,
      profile: profile ? { exists: true, status: profile.status || 'created' } : null,
      banks: visibleBanks.map((bank) => ({
        id: bank.id,
        source_id: bank.source_id || '',
        account_name: bank.account_name || '',
        account_mask: bank.account_mask || '',
        is_primary: !!bank.is_primary,
        status: bank.status || 'added',
        added_at: bank.added_at || '',
        verified_at: bank.verified_at || '',
      })),
      recent: recent.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        status: tx.status,
        integration_status: tx.integration_status || '',
        description: tx.description || '',
        funding_source_id: tx.funding_source_id || '',
        created_date: tx.created_date,
      })),
    });
  } catch (error) {
    return Response.json({ error: error?.message || 'Unable to load funding state' }, { status: 500 });
  }
});
