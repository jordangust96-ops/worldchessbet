import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { postLedgerLegs } from '../../shared/ledger.ts';
import { recordIntegrationEvent } from '../../shared/integrationEvents.ts';
import { seamlessWithdrawalsEnabled } from '../../shared/seamlessFundingConfig.ts';
import { extendComplianceEvidenceRetention } from '../../shared/complianceEvidence.ts';
import { isSocureIdentityVerified } from '../../shared/identityEligibility.js';
import { legalNameFromUser } from '../../shared/legalName.ts';
import { isSocureBankVerificationAccepted, latestSocureBankVerification } from '../../shared/socureBankEligibility.js';
import {
  seamlessConfig, seamlessRequest, buildWithdrawalBody,
  PATH_CHECK_SEND, SEAMLESS_PROVIDER_KEY,
} from '../../shared/seamlessAch.ts';
import { acquireUserWalletLock, releaseUserWalletLock } from '../../shared/seamlessAtomicStore.ts';

// Self-service account closure. Runs server-side with the service role so
// contest cancellations, refunds, and the closure payout are always computed
// via the Internal Ledger — never trusted from the client.

Deno.serve(async (req) => {
  let lockOwner = '';
  let lockedUserId = '';
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    if (user.account_state === 'closed') {
      return Response.json({ error: 'This account is already closed' }, { status: 400 });
    }

    // A closure payout is a withdrawal. Serialize against any concurrent
    // submitSeamlessWithdrawal (or a second, double-clicked closure request)
    // touching the same wallet, using the same lock those requests take.
    lockOwner = crypto.randomUUID();
    lockedUserId = user.id;
    if (!await acquireUserWalletLock(user.id, lockOwner)) {
      return Response.json({ error: 'withdrawal_in_progress', retryable: true }, { status: 409 });
    }

    // (i) Cancel any open Contest invitations — hosted/accepted contests that
    // have not yet fully started (searching, matched, or one-sided deposit),
    // refunding any escrowed deposit already made. Contests already
    // "in_progress" are left to settle normally per (iii).
    const [asHost, asOpponent] = await Promise.all([
      base44.asServiceRole.entities.Match.filter({ player1_id: user.id }),
      base44.asServiceRole.entities.Match.filter({ player2_id: user.id }),
    ]);
    const openInvitations = [...asHost, ...asOpponent].filter((m) =>
      ['searching', 'matched', 'deposited'].includes(m.status)
    );

    for (const match of openInvitations) {
      const refundTargets = [];
      if (match.player1_deposited) refundTargets.push(match.player1_id);
      if (match.player2_deposited) refundTargets.push(match.player2_id);

      for (const depositorId of refundTargets) {
        const walletTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
          launch_epoch: 2,
          user_id: depositorId,
          type: 'wager_refund',
          amount: match.wager_amount,
          match_id: match.id,
          description: 'Reserved contest funds refunded — account closure',
          status: 'completed',
        });

        await postLedgerLegs(base44, {
          groupId: `match:${match.id}:account_closure_match_cancelled:${walletTransaction.id}`,
          matchId: match.id,
          walletTransactionId: walletTransaction.id,
          actor: 'user',
          actorId: user.id,
          triggerEvent: 'account_closure_match_cancelled',
          externalRefType: 'match',
          externalRefId: match.id,
          legs: [
            { ledgerAccount: 'contest_clearing', debit: match.wager_amount, credit: 0, transactionType: 'refund' },
            { ledgerAccount: 'user_account', userId: depositorId, debit: 0, credit: match.wager_amount, heldDelta: -match.wager_amount, transactionType: 'refund', totalWageredDelta: -match.wager_amount },
          ],
        });
      }

      await base44.asServiceRole.entities.Match.update(match.id, { status: 'cancelled' });
      await recordIntegrationEvent(base44, {
        eventType: 'contest.cancelled',
        aggregateType: 'match',
        aggregateId: match.id,
        correlationId: match.id,
        idempotencyKey: `contest.cancelled:${match.id}`,
        actorType: 'user',
        actorId: user.id,
        userId: user.id,
        counterpartyUserId: match.player1_id === user.id ? match.player2_id : match.player1_id,
        matchId: match.id,
        status: 'cancelled',
        amount: match.wager_amount,
        result: 'account_closure',
        eventData: {
          refunded_user_ids: refundTargets,
        },
      });
    }

    // (iv) Disburse any remaining undisputed balance, subject to compliance
    // holds. A withdrawal_hold means the balance stays put pending review.
    //
    // This must actually reach the user's bank, not just move the ledger.
    // A prior version of this function debited Available Balance and
    // credited a generic 'settlement' account, leaving the WalletTransaction
    // 'pending'/'unrouted' with no code path that ever submitted it to
    // Seamless — real closure payouts got permanently stuck. This now
    // reuses the same reservation ledger accounts, IntegrationReference
    // shape, and check-send call as submitSeamlessWithdrawal, so a closure
    // payout is picked up by the exact same webhook and
    // reconcile-seamless-ach-statuses recovery machinery as any other
    // withdrawal — never a separate, unrouted path.
    let payout = null;
    let payoutStatus = null;
    if (!user.withdrawal_hold) {
      const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: user.id });
      const wallet = wallets[0];
      if (wallet && wallet.available_balance > 0) {
        payout = wallet.available_balance;

        if (!seamlessWithdrawalsEnabled()) {
          return Response.json({
            error: 'Payouts are not available yet, so an account with a remaining balance cannot be closed right now. Please try again later.',
            action: 'withdrawals_unavailable',
            available_balance: payout,
          }, { status: 409 });
        }
        if (!isSocureIdentityVerified(user)) {
          return Response.json({
            error: 'Complete identity verification before closing an account with a remaining balance.',
            action: 'identity_verification_required',
            available_balance: payout,
          }, { status: 400 });
        }
        const banks = await base44.asServiceRole.entities.SeamlessBankAccount.filter({ user_id: user.id, status: 'verified' });
        const bank = banks.find((item) => item.source_id && item.is_primary) || banks[0];
        if (!bank?.source_id) {
          return Response.json({
            error: 'Link and verify a bank account before closing an account with a remaining balance — there is no way to send your remaining balance without one.',
            action: 'bank_link_required',
            available_balance: payout,
          }, { status: 400 });
        }
        const bankVerifications = await base44.asServiceRole.entities.SocureBankVerification.filter({ user_id: user.id, source_id: bank.source_id });
        const bankVerification = latestSocureBankVerification(bankVerifications, bank.source_id);
        if (!isSocureBankVerificationAccepted(bankVerification, bank.source_id)) {
          return Response.json({
            error: 'Complete bank account screening before closing an account with a remaining balance.',
            action: 'bank_screening_required',
            available_balance: payout,
          }, { status: 400 });
        }
        const profile = (await base44.asServiceRole.entities.SeamlessPaymentProfile.filter({ user_id: user.id }))[0];
        if (!profile?.provider_user_id) {
          return Response.json({ error: 'No Seamless customer profile', action: 'ensure_customer', available_balance: payout }, { status: 400 });
        }
        let complianceEvidence;
        try {
          complianceEvidence = await extendComplianceEvidenceRetention(base44, { userId: user.id, fundingSourceId: bank.source_id, requireAchAuthorization: false });
        } catch {
          return Response.json({
            error: 'Required retained identity evidence is unavailable.',
            action: 'compliance_evidence_required',
            available_balance: payout,
          }, { status: 409 });
        }
        const accountHolderName = legalNameFromUser(user);
        if (!accountHolderName) {
          return Response.json({
            error: 'A verified account holder name is required before closing an account with a remaining balance.',
            available_balance: payout,
          }, { status: 400 });
        }
        seamlessConfig(); // fail closed before any provider mutation

        const walletTransaction = await base44.asServiceRole.entities.WalletTransaction.create({
          launch_epoch: 2,
          user_id: user.id,
          type: 'withdrawal',
          amount: payout,
          description: 'Account closure disbursement',
          status: 'pending',
          integration_status: 'pending',
          currency: 'USD',
          direction: 'reserve',
          source_event: 'account_closure_withdrawal_request',
          initiating_actor: 'user',
          initiating_actor_id: user.id,
          correlation_id: '',
          schema_version: 1,
          // Same rationale as submitSeamlessWithdrawal: capture the specific
          // bank account used now, not re-derived later from the user's
          // (possibly since-changed) primary bank account.
          funding_source_id: bank.source_id,
          ach_authorization_id: complianceEvidence?.authorization_id || '',
        });

        // Reserve funds using the same ledger accounts/group-id convention as
        // a normal withdrawal (not the old direct debit-to-'settlement'
        // pattern), so this transaction is indistinguishable from a
        // self-service withdrawal to every downstream consumer (webhook,
        // reconciliation sweep, admin tooling).
        const reservationGroupId = `seamless:withdrawal:reserve:${walletTransaction.id}`;
        await postLedgerLegs(base44, {
          groupId: reservationGroupId,
          walletTransactionId: walletTransaction.id,
          actor: 'user',
          actorId: user.id,
          triggerEvent: 'withdrawal_reservation',
          externalRefType: 'provider_payout',
          externalRefId: walletTransaction.id,
          legs: [
            { ledgerAccount: 'user_account', userId: user.id, debit: payout, credit: 0, heldDelta: payout, transactionType: 'withdrawal' },
            { ledgerAccount: 'withdrawal_reserve', debit: 0, credit: payout, transactionType: 'withdrawal' },
          ],
        });
        await base44.asServiceRole.entities.WalletTransaction.update(walletTransaction.id, {
          integration_status: 'reserved', source_event: 'account_closure_withdrawal_reservation',
        });

        const label = `chessbet-closure-${walletTransaction.id}`;
        await base44.asServiceRole.entities.IntegrationReference.create({
          provider_key: SEAMLESS_PROVIDER_KEY, reference_type: 'payout', external_reference_id: label,
          internal_entity_type: 'wallet_transaction', internal_entity_id: walletTransaction.id, correlation_id: walletTransaction.id,
          idempotency_key: `account-closure:${walletTransaction.id}`, user_id: user.id, wallet_transaction_id: walletTransaction.id,
          status: 'submitting', effective_at: new Date().toISOString(),
          metadata_json: JSON.stringify({ provider: SEAMLESS_PROVIDER_KEY, direction: 'withdrawal', label, source_id: bank.source_id, transfer_speed: 'standard' }),
        });
        await base44.asServiceRole.entities.WalletTransaction.update(walletTransaction.id, {
          integration_status: 'submitting', source_event: 'account_closure_withdrawal_submitting',
        });

        let data;
        try {
          data = await seamlessRequest('POST', PATH_CHECK_SEND, buildWithdrawalBody({
            providerUserId: profile.provider_user_id, name: accountHolderName.fullName, amount: payout,
            description: 'Account closure disbursement', label, sourceId: bank.source_id,
          }));
        } catch (error) {
          const status = Number(error?.status || 0);
          if (status >= 400 && status < 500) {
            // Provider rejected outright — release the reservation back to
            // available balance rather than stranding it, and stop the closure
            // so the user can resolve the rejection (e.g. re-link their bank)
            // with their account still open.
            const releaseGroupId = `seamless:withdrawal:release:${walletTransaction.id}`;
            await postLedgerLegs(base44, {
              groupId: releaseGroupId,
              walletTransactionId: walletTransaction.id,
              actor: 'system',
              triggerEvent: 'withdrawal_reservation_release',
              externalRefType: 'provider_payout',
              externalRefId: walletTransaction.id,
              legs: [
                { ledgerAccount: 'withdrawal_reserve', debit: payout, credit: 0, transactionType: 'reversal' },
                { ledgerAccount: 'user_account', userId: user.id, debit: 0, credit: payout, heldDelta: -payout, transactionType: 'reversal' },
              ],
            });
            await base44.asServiceRole.entities.WalletTransaction.update(walletTransaction.id, {
              status: 'failed', integration_status: 'failed', source_event: 'account_closure_withdrawal_rejected',
              description: `Account closure disbursement rejected by Seamless: ${String(error?.message || '').slice(0, 200)}`,
              processed_at: new Date().toISOString(),
            });
            return Response.json({
              error: 'Unable to submit your closure payout to your bank. Your balance was not moved — please try again, or contact support.',
              available_balance: payout,
            }, { status: 502 });
          }
          // Ambiguous network/provider outcome: never retry blindly and never
          // release the reservation — the existing Seamless status-recovery
          // sweep (reconcile-seamless-ach-statuses) resolves this exactly like
          // any other uncertain withdrawal once the true outcome is knowable.
          await base44.asServiceRole.entities.WalletTransaction.update(walletTransaction.id, {
            integration_status: 'uncertain', source_event: 'account_closure_withdrawal_uncertain',
          });
          payoutStatus = 'uncertain';
          data = null;
        }

        if (data) {
          const providerRef = data?.check_id || data?.check?.id || data?.id || data?.check?.check_id || '';
          if (providerRef) {
            await base44.asServiceRole.entities.IntegrationReference.create({
              provider_key: SEAMLESS_PROVIDER_KEY, reference_type: 'payout', external_reference_id: providerRef,
              internal_entity_type: 'wallet_transaction', internal_entity_id: walletTransaction.id, correlation_id: walletTransaction.id,
              idempotency_key: `account-closure:${walletTransaction.id}:ref`, user_id: user.id, wallet_transaction_id: walletTransaction.id,
              status: 'submitted', effective_at: new Date().toISOString(),
              metadata_json: JSON.stringify({ provider: SEAMLESS_PROVIDER_KEY, direction: 'withdrawal', label, source_id: bank.source_id, transfer_speed: 'standard' }),
            });
            await base44.asServiceRole.entities.WalletTransaction.update(walletTransaction.id, {
              integration_status: 'submitted', source_event: 'account_closure_withdrawal_submitted',
            });
            payoutStatus = 'submitted';
          } else {
            await base44.asServiceRole.entities.WalletTransaction.update(walletTransaction.id, {
              integration_status: 'uncertain', source_event: 'account_closure_withdrawal_uncertain',
            });
            payoutStatus = 'uncertain';
          }
        }

        await recordIntegrationEvent(base44, {
          eventType: 'financial.seamless_withdrawal_submitted', aggregateType: 'wallet_transaction', aggregateId: walletTransaction.id,
          correlationId: walletTransaction.id, idempotencyKey: `seamless:withdrawal:submitted:${walletTransaction.id}`,
          actorType: 'user', actorId: user.id, userId: user.id, walletTransactionId: walletTransaction.id,
          status: payoutStatus || 'pending', amount: payout, result: payoutStatus || 'pending',
          eventData: { provider: SEAMLESS_PROVIDER_KEY, label, reason: 'account_closure' },
        });
      }
    }

    // (v) Transition the Account to Closed status — this also blocks new
    // deposits, withdrawals, and contest entry per the existing account_state gate.
    const updatedUser = await base44.asServiceRole.entities.User.update(user.id, {
      account_state: 'closed',
    });

    await recordIntegrationEvent(base44, {
      eventType: 'account.closed',
      aggregateType: 'user',
      aggregateId: user.id,
      correlationId: user.id,
      idempotencyKey: `account.closed:${user.id}`,
      actorType: 'user',
      actorId: user.id,
      userId: user.id,
      status: updatedUser.account_state,
      amount: payout || 0,
      result: user.withdrawal_hold ? 'funds_held_for_compliance' : 'closure_requested',
      eventData: {
        cancelled_match_ids: openInvitations.map((match) => match.id),
        payout_pending: payout,
        withdrawal_hold: !!user.withdrawal_hold,
      },
    });

    return Response.json({
      success: true,
      cancelled_invitations: openInvitations.length,
      payout_pending: payout,
      payout_status: payoutStatus,
      held_for_compliance: !!user.withdrawal_hold,
      user: updatedUser,
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'backend_function_failed', error: error?.message || 'unknown_error' }));
    return Response.json({ error: 'internal_error' }, { status: 500 });
  } finally {
    if (lockedUserId && lockOwner) {
      try { await releaseUserWalletLock(lockedUserId, lockOwner); } catch { /* TTL safely releases an unavailable store lock. */ }
    }
  }
});