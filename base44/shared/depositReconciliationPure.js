import { depositQuote } from './depositPricing.js';

export function isFeeDeposit(tx) {
  return tx?.type === 'deposit' && (
    tx.deposit_pricing_version != null || tx.deposit_bank_debit != null ||
    tx.deposit_processing_fee != null
  );
}

export function moneyCents(value) {
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('invalid_money');
  if (typeof value === 'string' && !/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('invalid_money');
  const number = Number(value);
  const cents = Math.round(number * 100);
  if (!Number.isFinite(number) || number < 0 || cents > 100000000 ||
      Math.abs(number * 100 - cents) > 0.000001) throw new Error('invalid_money');
  return cents;
}

export function expectedDeposit(tx) {
  const quote = depositQuote(tx.amount);
  if (!quote || tx.deposit_pricing_version !== quote.version ||
      moneyCents(tx.deposit_bank_debit) !== moneyCents(quote.bankDebit) ||
      moneyCents(tx.deposit_processing_fee) !== moneyCents(quote.fee) ||
      !Number.isFinite(Date.parse(tx.deposit_fee_accepted_at || ''))) {
    throw new Error('invalid_saved_deposit_quote');
  }
  return { gross: moneyCents(quote.bankDebit), fee: moneyCents(quote.fee), net: moneyCents(quote.walletAmount) };
}

// Only the documented check object is accepted. check.fee is deliberately NOT
// interpreted as the merchant processing deduction: the live dashboard shows
// Fee: 0 even when the merchant's proceeds are reduced.
export function verifyProviderDeposit(tx, providerRef, data, requireProcessed = true) {
  const expected = expectedDeposit(tx);
  const check = data?.check || data?.data?.check;
  if (!check || data?.success === false || String(check.check_id || '') !== providerRef ||
      !providerRef || providerRef.startsWith('chessbet-')) throw new Error('provider_reference_mismatch');
  if (moneyCents(check.amount) !== expected.gross) throw new Error('provider_bank_debit_mismatch');
  if (check.currency != null && check.currency !== 'USD') throw new Error('provider_currency_mismatch');
  if (check.label && check.label !== 'chessbet-deposit-' + tx.id) throw new Error('provider_label_mismatch');
  const status = String(check.status || '').toLowerCase();
  if (requireProcessed && status !== 'processed') throw new Error('provider_not_processed');
  return { ...expected, status };
}

export function verifySettlementEvidence(tx, evidence, providerRef) {
  const expected = expectedDeposit(tx);
  if (!evidence || evidence.kind !== 'settlement' || evidence.result !== 'matched' ||
      evidence.wallet_transaction_id !== tx.id || evidence.provider_reference_id !== providerRef ||
      evidence.pricing_version !== tx.deposit_pricing_version ||
      moneyCents(evidence.bank_debit) !== expected.gross ||
      moneyCents(evidence.processing_fee) !== expected.fee ||
      moneyCents(evidence.net_received) !== expected.net ||
      !evidence.evidence_reference || !evidence.recorded_by ||
      !['seamless_statement', 'seamless_support'].includes(evidence.source)) {
    throw new Error('settlement_evidence_required');
  }
  return expected;
}

export function settlementMatches(tx, values) {
  const expected = expectedDeposit(tx);
  const gross = moneyCents(values.bank_debit), fee = moneyCents(values.processing_fee);
  const net = moneyCents(values.net_received);
  return gross === expected.gross && fee === expected.fee && net === expected.net && gross - fee === net;
}

export function returnFeeAmounts(tx, values) {
  const expected = expectedDeposit(tx);
  const retained = moneyCents(values.processing_fee_retained);
  const returnedFee = moneyCents(values.return_fee);
  const cash = moneyCents(values.additional_cash_debit);
  if (retained > expected.fee || retained + returnedFee !== cash) throw new Error('return_fee_amount_mismatch');
  return { retained, returnFee: returnedFee, cash };
}
