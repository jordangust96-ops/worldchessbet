import { EARLY_ACCESS_MODE, EARLY_ACCESS_STARTING_BALANCE } from './earlyAccess.ts';
import { postLedgerLegs } from './ledger.ts';

export const EARLY_ACCESS_DESCRIPTION = 'Early Access bonus balance — pre-launch testing credit';
const SOURCE_EVENT = 'early_access_bonus';
const PENDING_RECOVERY_MS = 30_000;

function createdAt(record) {
  const value = new Date(record?.created_date || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function pickCanonical(records) {
  return [...records].sort((a, b) => createdAt(a) - createdAt(b) || String(a.id).localeCompare(String(b.id)))[0] || null;
}

async function getWallet(base44, userId) {
  const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: userId });
  let wallet = wallets.find((item) => item.early_access_credited) || wallets[0];
  if (!wallet) {
    wallet = await base44.asServiceRole.entities.Wallet.create({
      user_id: userId,
      balance: 0,
      available_balance: 0,
      held_balance: 0,
      total_balance: 0,
      total_wagered: 0,
      total_won: 0,
      total_deposited: 0,
      total_withdrawn: 0,
      early_access_credited: false,
    });
  }
  return wallet;
}

async function finalWallet(base44, userId) {
  const wallets = await base44.asServiceRole.entities.Wallet.filter({ user_id: userId });
  return wallets.find((item) => item.early_access_credited) || wallets[0] || null;
}

// Creates the Early Access wallet credit from either the signup workflow or
// an authenticated user's page bootstrap. The stable source event and
// candidate election make simultaneous workflow/page requests converge on one
// ledger posting instead of granting the bonus twice.
export async function ensureEarlyAccessFunds(base44, userId) {
  if (!userId) throw new Error('userId is required');

  let wallet = await getWallet(base44, userId);
  if (!EARLY_ACCESS_MODE) {
    return { wallet, newly_credited: false, early_access_mode: false };
  }

  const existingTransactions = await base44.asServiceRole.entities.WalletTransaction.filter({
    user_id: userId,
    source_event: SOURCE_EVENT,
  });
  const completed = existingTransactions.find((transaction) => transaction.status === 'completed');
  if (completed) {
    if (!wallet.early_access_credited) {
      await base44.asServiceRole.entities.Wallet.update(wallet.id, { early_access_credited: true });
      wallet = await finalWallet(base44, userId);
    }
    return { wallet, newly_credited: false, transaction_id: completed.id };
  }

  // Preserve compatibility with credits issued before source_event was added.
  if (wallet.early_access_credited) {
    return { wallet, newly_credited: false };
  }

  let candidate = pickCanonical(existingTransactions.filter((transaction) => transaction.status === 'pending'));
  if (candidate) {
    const ledgerEntries = await base44.asServiceRole.entities.LedgerEntry.filter({
      wallet_transaction_id: candidate.id,
    });
    if (ledgerEntries.length >= 2) {
      await base44.asServiceRole.entities.WalletTransaction.update(candidate.id, {
        status: 'completed',
        integration_status: 'internal_complete',
        processed_at: new Date().toISOString(),
      });
      await base44.asServiceRole.entities.Wallet.update(wallet.id, { early_access_credited: true });
      return {
        wallet: await finalWallet(base44, userId),
        newly_credited: false,
        transaction_id: candidate.id,
        recovered: true,
      };
    }

    const age = Date.now() - createdAt(candidate);
    if (age < PENDING_RECOVERY_MS) {
      return { wallet, newly_credited: false, processing: true, transaction_id: candidate.id };
    }
  } else {
    const idempotencyKey = `early-access:${userId}:v1`;
    candidate = await base44.asServiceRole.entities.WalletTransaction.create({
      user_id: userId,
      type: 'deposit',
      amount: EARLY_ACCESS_STARTING_BALANCE,
      description: EARLY_ACCESS_DESCRIPTION,
      status: 'pending',
      currency: 'USD',
      direction: 'credit',
      source_event: SOURCE_EVENT,
      initiating_actor: 'system',
      integration_status: 'pending',
      idempotency_key: idempotencyKey,
      correlation_id: idempotencyKey,
      schema_version: 1,
    });

    // Allow a simultaneous signup/page request to publish its candidate before
    // electing the earliest record as the only posting authority.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const candidates = await base44.asServiceRole.entities.WalletTransaction.filter({
      user_id: userId,
      source_event: SOURCE_EVENT,
    });
    const canonical = pickCanonical(candidates.filter((transaction) =>
      transaction.status === 'pending' || transaction.status === 'completed'
    ));

    if (canonical && canonical.id !== candidate.id) {
      await base44.asServiceRole.entities.WalletTransaction.update(candidate.id, {
        status: 'failed',
        integration_status: 'failed',
        description: `${EARLY_ACCESS_DESCRIPTION} — duplicate request suppressed`,
      });
      return {
        wallet: await finalWallet(base44, userId),
        newly_credited: false,
        processing: canonical.status !== 'completed',
        transaction_id: canonical.id,
      };
    }
  }

  const groupId = crypto.randomUUID();
  await postLedgerLegs(base44, {
    groupId,
    walletTransactionId: candidate.id,
    actor: 'system',
    triggerEvent: SOURCE_EVENT,
    legs: [
      {
        ledgerAccount: 'settlement',
        debit: EARLY_ACCESS_STARTING_BALANCE,
        credit: 0,
        transactionType: 'deposit',
      },
      {
        ledgerAccount: 'user_account',
        userId,
        debit: 0,
        credit: EARLY_ACCESS_STARTING_BALANCE,
        transactionType: 'deposit',
        totalDepositedDelta: EARLY_ACCESS_STARTING_BALANCE,
      },
    ],
  });

  await base44.asServiceRole.entities.Wallet.update(wallet.id, { early_access_credited: true });
  return {
    wallet: await finalWallet(base44, userId),
    newly_credited: true,
    transaction_id: candidate.id,
  };
}
