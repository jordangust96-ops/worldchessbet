import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Pure-JS model of the settlement-transparency fix: postLedgerLegs' wallet-
// transaction-completion behavior (base44/shared/ledger.ts) plus
// settleMatch's decisive-branch flow (base44/functions/settleMatch/entry.ts).
//
// Before this fix, a decisive Match result created exactly one
// WalletTransaction (the winner's 'payout'); the loser's held-funds release
// was posted only as a zero-value LedgerEntry leg tied to the WINNER's
// transaction id, so a losing player's Wallet history never showed a
// distinct, timestamped record of the match ending. This now creates a
// second WalletTransaction (type 'wager_forfeit') for the loser, posted and
// completed atomically alongside the winner's payout in the same balanced
// ledger posting, and tags the loser's ledger leg 'match_release' instead of
// reusing 'match_settlement'.

function createLedgerModel() {
  const wallets = new Map(); // userId -> { available, held }
  const transactions = new Map(); // id -> { id, status }
  const ledgerEntries = [];

  function ensureWallet(userId) {
    if (!wallets.has(userId)) wallets.set(userId, { available: 0, held: 0 });
    return wallets.get(userId);
  }

  function registerTransaction(id) {
    transactions.set(id, { id, status: 'pending' });
  }

  // Mirrors postLedgerLegs: validates the posting balances, applies wallet
  // deltas, tags each user_account LedgerEntry with the leg's own
  // walletTransactionId (falling back to the call-level one), then marks
  // every distinct WalletTransaction referenced across the legs as
  // 'completed' — not just the call-level/primary one.
  function postLedgerLegs({ walletTransactionId, legs }) {
    const totalDebit = legs.reduce((s, l) => s + (l.debit || 0), 0);
    const totalCredit = legs.reduce((s, l) => s + (l.credit || 0), 0);
    if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
      throw new Error(`unbalanced legs: debit=${totalDebit} credit=${totalCredit}`);
    }
    for (const leg of legs) {
      if (leg.ledgerAccount !== 'user_account') continue;
      const wallet = ensureWallet(leg.userId);
      wallet.available += (leg.credit || 0) - (leg.debit || 0);
      wallet.held += leg.heldDelta || 0;
      ledgerEntries.push({
        userId: leg.userId,
        transactionType: leg.transactionType,
        walletTransactionId: leg.walletTransactionId || walletTransactionId || '',
        debit: leg.debit || 0,
        credit: leg.credit || 0,
      });
    }
    const completedIds = [...new Set(
      legs.map((leg) => leg.walletTransactionId).concat([walletTransactionId]).filter(Boolean)
    )];
    for (const id of completedIds) {
      const tx = transactions.get(id);
      if (tx) tx.status = 'completed';
    }
    return completedIds;
  }

  return { ensureWallet, registerTransaction, postLedgerLegs, wallets, transactions, ledgerEntries };
}

// Scenario 1: a decisive settlement posts the winner's payout and the
// loser's forfeiture in one balanced call. Both transactions must complete
// together, the loser's own ledger entry must reference their OWN
// transaction (not the winner's), and it must be tagged 'match_release'.
{
  const model = createLedgerModel();
  const winner = 'winner-1';
  const loser = 'loser-1';
  const wagerAmount = 100;
  const serviceFee = 5;
  const pot = wagerAmount * 2;
  const totalFee = serviceFee * 2;

  model.ensureWallet(winner).held = wagerAmount + serviceFee;
  model.ensureWallet(loser).held = wagerAmount + serviceFee;

  const payoutTxId = 'tx-payout';
  const forfeitTxId = 'tx-forfeit';
  model.registerTransaction(payoutTxId);
  model.registerTransaction(forfeitTxId);

  const legs = [
    { ledgerAccount: 'contest_clearing', debit: pot, credit: 0, transactionType: 'match_settlement' },
    { ledgerAccount: 'suspense', debit: totalFee, credit: 0, transactionType: 'platform_fee' },
    {
      ledgerAccount: 'user_account', userId: winner, debit: 0, credit: pot,
      heldDelta: -(wagerAmount + serviceFee), transactionType: 'match_settlement',
      walletTransactionId: payoutTxId,
    },
    { ledgerAccount: 'platform_revenue', debit: 0, credit: totalFee, transactionType: 'platform_fee' },
    {
      ledgerAccount: 'user_account', userId: loser, debit: 0, credit: 0,
      heldDelta: -(wagerAmount + serviceFee), transactionType: 'match_release',
      walletTransactionId: forfeitTxId,
    },
  ];

  const completedIds = model.postLedgerLegs({ walletTransactionId: payoutTxId, legs });

  assert.deepEqual(
    completedIds.slice().sort(),
    [forfeitTxId, payoutTxId].sort(),
    'one balanced posting completes both the winner and loser transactions'
  );
  assert.equal(model.transactions.get(payoutTxId).status, 'completed');
  assert.equal(
    model.transactions.get(forfeitTxId).status,
    'completed',
    'the loser now gets their own completed transaction, not just a bystander ledger leg'
  );

  const winnerWallet = model.wallets.get(winner);
  const loserWallet = model.wallets.get(loser);
  assert.equal(winnerWallet.available, pot, 'winner receives the full pot');
  assert.equal(winnerWallet.held, 0, "winner's hold is fully released");
  assert.equal(loserWallet.available, 0, "loser's available balance never changes — nothing is credited back");
  assert.equal(loserWallet.held, 0, "loser's hold is fully released (forfeited, not refunded)");

  const loserEntry = model.ledgerEntries.find((entry) => entry.userId === loser);
  assert.equal(loserEntry.walletTransactionId, forfeitTxId, "the loser's ledger entry references their OWN transaction, not the winner's");
  assert.equal(loserEntry.transactionType, 'match_release', "the loser's release is tagged distinctly from the winner's settlement leg");

  const winnerEntry = model.ledgerEntries.find((entry) => entry.userId === winner);
  assert.equal(winnerEntry.walletTransactionId, payoutTxId, "the winner's ledger entry still references their own transaction");
}

// Scenario 2: the loser's zero-value leg is inert to the core double-entry
// balance check — adding it never by itself unbalances an otherwise-balanced
// posting.
{
  const model = createLedgerModel();
  model.registerTransaction('tx-w');
  model.registerTransaction('tx-l');
  const legs = [
    { ledgerAccount: 'contest_clearing', debit: 50, credit: 0, transactionType: 'match_settlement' },
    { ledgerAccount: 'user_account', userId: 'w', debit: 0, credit: 50, heldDelta: -55, transactionType: 'match_settlement', walletTransactionId: 'tx-w' },
    { ledgerAccount: 'user_account', userId: 'l', debit: 0, credit: 0, heldDelta: -55, transactionType: 'match_release', walletTransactionId: 'tx-l' },
  ];
  assert.doesNotThrow(() => model.postLedgerLegs({ walletTransactionId: 'tx-w', legs }));
}

// Scenario 3: a call with no per-leg walletTransactionId override behaves
// exactly as before this fix — every existing single-transaction call site
// (deposits, withdrawals, draw refunds, etc.) is unaffected.
{
  const model = createLedgerModel();
  model.registerTransaction('tx-single');
  const legs = [
    { ledgerAccount: 'contest_clearing', debit: 20, credit: 0, transactionType: 'refund' },
    { ledgerAccount: 'user_account', userId: 'u', debit: 0, credit: 20, heldDelta: -20, transactionType: 'refund' },
  ];
  const completedIds = model.postLedgerLegs({ walletTransactionId: 'tx-single', legs });
  assert.deepEqual(completedIds, ['tx-single'], 'a call with no leg-level override still completes exactly one transaction');
}

// Cross-check against the actual deployed source so a future edit that
// quietly drops this fix fails this test, not just the model above.
const [
  settleMatchSrc,
  ledgerSrc,
  walletTxSchemaSrc,
  reconciliationSrc,
  transactionHistorySrc,
  shareXSrc,
  shareFbSrc,
] = await Promise.all([
  readFile(new URL('../base44/functions/settleMatch/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/shared/ledger.ts', import.meta.url), 'utf8'),
  readFile(new URL('../base44/entities/WalletTransaction.jsonc', import.meta.url), 'utf8'),
  readFile(new URL('../base44/functions/resolveSettlementReconciliation/entry.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/wallet/TransactionHistory.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/play/matchview/ShareOnXButton.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/play/matchview/ShareOnFacebookButton.jsx', import.meta.url), 'utf8'),
]);

assert.match(walletTxSchemaSrc, /"wager_forfeit"/, 'WalletTransaction.type enum includes wager_forfeit');
assert.match(settleMatchSrc, /type: 'wager_forfeit'/, 'settleMatch creates a wager_forfeit transaction for the loser');
assert.match(settleMatchSrc, /transactionType: 'match_release'/, "the loser's settlement leg is tagged match_release, not match_settlement");
assert.match(settleMatchSrc, /walletTransactionId: loserTransaction\?\.id/, "the loser's leg is posted under their own transaction id");
assert.match(settleMatchSrc, /\['payout', 'wager_refund', 'wager_forfeit', 'service_fee_refund'\]\.includes\(transaction\.type\)/, 'the stale-lease settlement-evidence check recognizes wager_forfeit as financial evidence');
assert.match(ledgerSrc, /leg\.walletTransactionId \|\| walletTransactionId/, 'postLedgerLegs supports a per-leg walletTransactionId override');
assert.match(ledgerSrc, /walletTransactionIds = \[\.\.\.new Set\(/, 'postLedgerLegs completes every distinct WalletTransaction referenced by a posting, not just the primary one');
assert.match(ledgerSrc, /wager_forfeit: 'release'/, 'postLedgerLegs direction map covers wager_forfeit');
assert.match(reconciliationSrc, /'wager_forfeit'/, 'admin settlement reconciliation recognizes wager_forfeit as a settlement transaction type');
assert.match(reconciliationSrc, /orphanTransactions\.map/, 'admin settlement reconciliation abandons every orphaned settlement transaction, not just the first');
assert.match(transactionHistorySrc, /wager_forfeit: \{/, 'the Wallet transaction list has a distinct row for wager_forfeit');
assert.match(shareXSrc, /window\.open\("", "_blank"\)/, 'ShareOnXButton opens its share tab synchronously within the click gesture');
assert.match(shareFbSrc, /window\.open\("", "_blank"\)/, 'ShareOnFacebookButton opens its share tab synchronously within the click gesture');

console.log('Settlement transparency (loser transaction + match_release + share-tab timing) validation passed.');
