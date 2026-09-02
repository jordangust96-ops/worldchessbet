import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import {
  seamlessDepositsEnabled,
  seamlessThirdPartyFundingEnabled,
  seamlessWithdrawalsEnabled,
} from '../../shared/seamlessFundingConfig.ts';
import { isSocureIdentityVerified } from '../../shared/identityEligibility.js';
import { legalNameFromUser } from '../../shared/legalName.ts';
import { socureConfig } from '../../shared/socure.ts';
import { latestSocureBankVerification, publicSocureBankStatus } from '../../shared/socureBankEligibility.js';

// Read-only view of the authenticated user's Seamless funding state for the
// Wallet page. Reads ONLY our own stored records (SeamlessPaymentProfile,
// SeamlessBankAccount, recent pending Seamless WalletTransactions) — it does
// NOT call the Seamless API. (No provider transaction readback endpoint is
// proven in the current Seamless ACH v2 references; that gap is flagged as a
// launch blocker in the build report.)
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const depositsEnabled = seamlessDepositsEnabled();
    const withdrawalsEnabled = seamlessWithdrawalsEnabled();
    const thirdPartyFundingEnabled = seamlessThirdPartyFundingEnabled();
    let bankScreeningEnabled = false;
    try { bankScreeningEnabled = !!socureConfig().enabled; } catch { bankScreeningEnabled = false; }

    const profile = (
      await base44.asServiceRole.entities.SeamlessPaymentProfile.filter({ user_id: user.id })
    )[0] || null;

    const banks = await base44.asServiceRole.entities.SeamlessBankAccount.filter(
      { user_id: user.id }, '-added_at', 50
    );
    const bankVerifications = await base44.asServiceRole.entities.SocureBankVerification.filter(
      { user_id: user.id }, '-requested_at', 100
    );

    // `source_event` is mutated as a deposit/withdrawal progresses (created ->
    // *_submitting -> *_submitted/*_uncertain, then overwritten again by
    // postLedgerLegs to the raw triggerEvent on settlement), so it is never a
    // stable filter value once a transaction leaves its initial instant. `type`
    // and `launch_epoch` are set once at creation and never changed afterward.
    const [deposits, withdrawals] = await Promise.all([
      base44.asServiceRole.entities.WalletTransaction.filter(
        { launch_epoch: 2, user_id: user.id, type: 'deposit' }, '-created_date', 10
      ),
      base44.asServiceRole.entities.WalletTransaction.filter(
        { launch_epoch: 2, user_id: user.id, type: 'withdrawal' }, '-created_date', 10
      ),
    ]);
    const recent = [...deposits, ...withdrawals]
      .sort((a, b) => new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime())
      .slice(0, 10);

    return Response.json({
      enabled: true,
      deposits_enabled: depositsEnabled,
      withdrawals_enabled: withdrawalsEnabled,
      third_party_funding_enabled: thirdPartyFundingEnabled,
      bank_screening_enabled: bankScreeningEnabled,
      identity_verified: isSocureIdentityVerified(user),
      legal_name: legalNameFromUser(user)?.fullName || '',
      identity_status: user.identity_verification_status || 'not_started',
      account_state: user.account_state || 'provisional',
      withdrawal_hold: !!user.withdrawal_hold,
      profile: profile ? { exists: true, status: profile.status || 'created' } : null,
      banks: banks.map((bank) => {
        const verification = latestSocureBankVerification(bankVerifications, bank.source_id);
        return {
          id: bank.id,
          source_id: bank.source_id || '',
          account_name: bank.account_name || '',
          account_mask: bank.account_mask || '',
          is_primary: !!bank.is_primary,
          status: bank.status || 'added',
          socure_status: publicSocureBankStatus(verification),
          added_at: bank.added_at || '',
          verified_at: bank.verified_at || '',
        };
      }),
      recent: recent.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        status: tx.status,
        created_date: tx.created_date,
      })),
    });
  } catch (error) {
    return Response.json({ error: error?.message || 'Unable to load funding state' }, { status: 500 });
  }
});