import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus, ArrowUpRight, Loader2, CheckCircle2, Clock, AlertTriangle,
  XCircle, Link2, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import VerifiedThirdPartyFundingSourceForm from "./VerifiedThirdPartyFundingSourceForm";

// Seamless ACH funding panel. ChessBet captures the approved ACH authorization,
// runs Socure Account Intelligence, and only then asks Seamless to create a verified
// third-party funding source. Provider enrollment, deposits, and withdrawals each
// have independent server-only feature switches.

const BANK_STATUS = {
  verified: { label: "Connected", color: "text-emerald-400", icon: CheckCircle2 },
  pending_verification: { label: "Connecting", color: "text-amber-400", icon: Clock },
  added: { label: "Connecting", color: "text-amber-400", icon: Clock },
  verification_failed: { label: "Needs attention", color: "text-red-400", icon: XCircle },
  verification_expired: { label: "Reconnect required", color: "text-red-400", icon: XCircle },
  deleted: { label: "Removed", color: "text-white/40", icon: XCircle },
  error: { label: "Needs attention", color: "text-red-400", icon: XCircle },
};

const TX_STATUS = {
  pending: { label: "Pending", color: "text-amber-400", icon: Clock },
  completed: { label: "Completed", color: "text-emerald-400", icon: CheckCircle2 },
  failed: { label: "Failed", color: "text-red-400", icon: XCircle },
  reversed: { label: "Reversed", color: "text-red-400", icon: RefreshCw },
};

function BankRow({ bank }) {
  let displayStatus = bank.status;
  if (bank.status === "verified" && bank.socure_status !== "verified") {
    displayStatus = ["failed", "review_required"].includes(bank.socure_status)
      ? "verification_failed"
      : "pending_verification";
  }
  const s = BANK_STATUS[displayStatus] || BANK_STATUS.added;
  const Icon = s.icon;
  return (
    <div className="flex items-center justify-between rounded-xl bg-white/[0.03] border border-white/5 px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-9 w-9 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0">
          <Link2 size={16} className="text-white/50" />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-white/90 truncate">
            {bank.account_name || "Bank account"}
            {bank.account_mask ? ` ending in ${bank.account_mask}` : ""}
          </p>
          {bank.is_primary && (
            <span className="text-[10px] uppercase tracking-wider text-[#C9A84C]">Primary</span>
          )}
        </div>
      </div>
      <span className={`flex items-center gap-1.5 text-xs font-medium ${s.color} shrink-0`}>
        <Icon size={14} /> {s.label}
      </span>
    </div>
  );
}

function TxRow({ tx }) {
  const s = TX_STATUS[tx.status] || TX_STATUS.pending;
  const Icon = s.icon;
  const isDeposit = tx.type === "deposit";
  return (
    <div className="flex items-center justify-between text-sm py-2">
      <div className="flex items-center gap-2 min-w-0">
        <Icon size={14} className={`${s.color} shrink-0`} />
        <span className="text-white/70 truncate">
          {isDeposit ? "Deposit" : "Withdrawal"}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={isDeposit ? "text-emerald-400" : "text-white/70"}>
          {isDeposit ? "+" : "-"}${Number(tx.amount || 0).toFixed(2)}
        </span>
        <span className={`text-xs ${s.color}`}>{s.label}</span>
      </div>
    </div>
  );
}

export default function SeamlessFundingPanel({
  wallet,
  accountState,
  withdrawalHold,
  onRefresh,
  onJourneyStateChange,
}) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState("deposit");
  const depositRequestKey = useRef("");
  const withdrawalRequestKey = useRef("");
  const pollAttempts = useRef(0);
  const load = useCallback(async () => {
    try {
      const { data } = await base44.functions.invoke("getSeamlessWalletState", {});
      setState(data);
      onJourneyStateChange?.({ bankStarted: !!data?.banks?.length });
      setError("");
    } catch (e) {
      setError(e?.message || "Unable to load funding status");
    } finally {
      setLoading(false);
    }
  }, [onJourneyStateChange]);

  useEffect(() => { load(); }, [load]);

  // Poll briefly while provider-created bank or transfer state is pending.
  // Stop after ten inexpensive refreshes; later visits reload server state.
  useEffect(() => {
    const hasPending =
      state?.banks?.some((b) =>
        ["added", "pending_verification"].includes(b.status) ||
        (b.status === "verified" && ["not_started", "processing"].includes(b.socure_status))
      ) ||
      state?.recent?.some((t) => t.status === "pending");
    if (!hasPending) {
      pollAttempts.current = 0;
      return;
    }
    if (pollAttempts.current >= 10) return;
    const timer = setTimeout(() => {
      pollAttempts.current += 1;
      load();
    }, 8000);
    return () => clearTimeout(timer);
  }, [state, load]);

  const submit = async () => {
    const v = parseFloat(amount);
    if (!v || v <= 0 || !wallet) return;
    setError(""); setBusy(direction);
    try {
      const fn = direction === "deposit" ? "submitSeamlessDeposit" : "submitSeamlessWithdrawal";
      const payload = { amount: v };
      const requestKey = direction === "deposit" ? depositRequestKey : withdrawalRequestKey;
      requestKey.current ||= crypto.randomUUID();
      payload.idempotencyKey = requestKey.current;
      const { data } = await base44.functions.invoke(fn, payload);
      if (!data?.enabled) throw new Error(data?.reason || "Bank transfers are unavailable right now.");
      // Preserve the key for an in-doubt provider result: pressing submit again
      // asks the server for the same logical transfer, never a second ACH request.
      if (data?.status !== "uncertain") requestKey.current = "";
      if (data?.status !== "uncertain") setAmount("");
      await load();
      if (onRefresh) onRefresh();
    } catch (e) {
      const serverMessage = e?.response?.data?.error;
      setError(typeof serverMessage === "string" && serverMessage
        ? serverMessage
        : "We couldn't submit that request. Please try again or contact support.");
    } finally {
      setBusy("");
    }
  };

  const MIN_DEPOSIT_AMOUNT = 10;
  const SMALL_WITHDRAWAL_THRESHOLD = 10;
  const SMALL_WITHDRAWAL_FEE = 2.5;
  const parsedAmount = parseFloat(amount);
  // Mirrors the server's full-balance fee waiver (submitSeamlessWithdrawal):
  // withdrawing the entire available balance skips the small-withdrawal fee,
  // so a balance under $10 (or even under the fee itself) is never stranded.
  const isFullBalanceWithdrawal =
    !!wallet && parsedAmount > 0 && parsedAmount >= (wallet.available_balance || 0) - 0.005;

  const depositsEnabled = !!state?.deposits_enabled;
  const withdrawalsEnabled = !!state?.withdrawals_enabled;
  const thirdPartyFundingEnabled = !!state?.third_party_funding_enabled;
  const bankScreeningEnabled = !!state?.bank_screening_enabled;
  const identityVerified = !!state?.identity_verified;
  const effectiveAccountState = state?.account_state || accountState;
  const effectiveWithdrawalHold = state?.withdrawal_hold ?? withdrawalHold;
  const notVerified = !identityVerified || effectiveAccountState !== "verified";
  const ineligible = effectiveWithdrawalHold || notVerified;
  const verifiedBank = state?.banks?.find((b) => b.status === "verified");
  const bankScreeningStatus = verifiedBank?.socure_status || "not_started";
  const bankScreened = bankScreeningStatus === "verified";
  const bankReady = !!verifiedBank && bankScreened;
  const depositComplete = !!state?.has_completed_deposit;
  const transferDirectionEnabled = direction === 'deposit' ? depositsEnabled : withdrawalsEnabled;
  const meetsMinimum = direction === 'deposit' ? parsedAmount >= MIN_DEPOSIT_AMOUNT : parsedAmount > 0;
  const canSubmit = !ineligible && bankReady && !busy && meetsMinimum && transferDirectionEnabled;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="animate-spin text-[#C9A84C]" size={22} />
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Account-state notices (preserved from the prior UX) */}
      {effectiveWithdrawalHold && (
        <p className="text-xs text-red-400/80 text-center">
          Withdrawals are temporarily on hold while we complete a routine account review.
        </p>
      )}
      {!effectiveWithdrawalHold && notVerified && effectiveAccountState === "provisional" && (
        <p className="text-xs text-white/40 text-center">
          Complete identity verification to unlock deposits and withdrawals.
        </p>
      )}
      {!effectiveWithdrawalHold && effectiveAccountState === "suspended" && (
        <p className="text-xs text-red-400/80 text-center">
          Your account is currently suspended. Deposits and withdrawals are unavailable.
        </p>
      )}
      {!effectiveWithdrawalHold && effectiveAccountState === "closed" && (
        <p className="text-xs text-red-400/80 text-center">
          This account is closed. Deposits and withdrawals are unavailable.
        </p>
      )}

      {/* Step 2: connect a bank. Provider screening and verification remain internal to this step. */}
      <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 space-y-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[#C9A84C]">Step 2</p>
          <h4 className="text-sm font-semibold text-white mt-1">
            {bankReady ? "Bank connected" : "Connect your bank"}
          </h4>
          <p className="text-xs text-white/45 mt-1">
            {!identityVerified
              ? "Complete Step 1 before connecting a bank."
              : bankReady
                ? "Your bank is connected and ready to use with ChessBet."
                : verifiedBank
                  ? "We're securely confirming your bank account. This page updates automatically."
                  : !thirdPartyFundingEnabled
                    ? "Bank connection is temporarily unavailable."
                    : !bankScreeningEnabled
                      ? "Bank connection is temporarily unavailable."
                      : "Add the bank account you'll use to deposit and withdraw funds."}
          </p>
        </div>

        {state?.banks?.length ? (
          <div className="space-y-2">
            {state.banks.map((bank) => <BankRow key={bank.id} bank={bank} />)}
          </div>
        ) : thirdPartyFundingEnabled && bankScreeningEnabled && identityVerified ? (
          <VerifiedThirdPartyFundingSourceForm
            legalName={state?.legal_name || ""}
            disabled={ineligible}
            onComplete={load}
          />
        ) : (
          <p className="text-xs text-white/30 text-center py-2">No bank connected yet.</p>
        )}
      </div>

      {/* Step 3: existing server-side transfer gates remain authoritative. */}
      <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 space-y-3">
        <div>
          <p className={`text-[10px] uppercase tracking-widest ${depositComplete ? "text-emerald-300/70" : "text-[#C9A84C]"}`}>
            {depositComplete ? "Step 3 · Complete" : "Step 3"}
          </p>
          <h4 className="text-sm font-semibold text-white mt-1">
            {depositComplete ? "ChessBet wallet funded" : "Deposit into your ChessBet wallet"}
          </h4>
          <p className="text-xs text-white/45 mt-1">
            {!identityVerified
              ? "Complete Step 1 first."
              : !bankReady
                ? "Complete Step 2 first."
                : direction === "withdrawal" && !withdrawalsEnabled
                  ? "Withdrawals are temporarily unavailable."
                  : direction === "withdrawal"
                    ? "Withdraw available funds back to your connected bank."
                    : depositComplete && !depositsEnabled
                      ? "Your wallet has been funded successfully. Additional deposits are temporarily unavailable."
                      : depositComplete
                        ? "Your wallet has been funded successfully. You can deposit more anytime."
                        : !depositsEnabled
                          ? "Deposits are temporarily unavailable."
                          : "Add funds from your connected bank to your ChessBet wallet."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Button
            onClick={() => setDirection("deposit")}
            className={`h-12 rounded-2xl font-bold disabled:opacity-30 ${
              direction === "deposit"
                ? "gold-gradient text-black"
                : "bg-white/[0.05] text-white/70 border border-white/10"
            }`}
            disabled={ineligible || !bankReady || !depositsEnabled}
          >
            <Plus size={16} className="mr-2" /> Deposit
          </Button>
          <Button
            onClick={() => setDirection("withdrawal")}
            disabled={ineligible || !bankReady || !withdrawalsEnabled || (wallet && (wallet.available_balance || 0) <= 0)}
            className={`h-12 rounded-2xl font-bold disabled:opacity-30 ${
              direction === "withdrawal"
                ? "gold-gradient text-black"
                : "bg-white/[0.05] text-white/70 border border-white/10"
            }`}
          >
            <ArrowUpRight size={16} className="mr-2" /> Withdraw Funds
          </Button>
        </div>
      </div>

      {/* Amount input + submit (deposit/withdraw share one form) */}
      <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 space-y-3">
        <input
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={direction === "deposit" ? "Amount to fund" : "Amount to withdraw"}
          disabled={ineligible || !bankReady || !transferDirectionEnabled}
          className="w-full h-12 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/20 text-sm focus:border-[#C9A84C]/50 focus:outline-none disabled:opacity-40"
        />
        {direction === "deposit" && (
          <p className="text-[11px] text-white/30 text-center">
            Minimum deposit: ${MIN_DEPOSIT_AMOUNT.toFixed(2)}
          </p>
        )}
        {direction === "withdrawal" && wallet && (wallet.available_balance || 0) > 0 && (
          <button
            type="button"
            onClick={() => setAmount(String((wallet.available_balance || 0).toFixed(2)))}
            disabled={ineligible || !bankReady || !transferDirectionEnabled}
            className="w-full text-[11px] text-[#C9A84C] text-center hover:underline disabled:opacity-40 disabled:pointer-events-none"
          >
            Withdraw full balance (${(wallet.available_balance || 0).toFixed(2)}) — no fee
          </button>
        )}
        {direction === "withdrawal" && parsedAmount > 0 && parsedAmount < SMALL_WITHDRAWAL_THRESHOLD && (
          isFullBalanceWithdrawal ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2.5 text-center">
              <p className="text-xs font-medium text-emerald-300">No fee — you're withdrawing your full balance</p>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5 text-center">
              <p className="text-xs font-semibold text-amber-300">
                ${SMALL_WITHDRAWAL_FEE.toFixed(2)} fee applies to withdrawals under ${SMALL_WITHDRAWAL_THRESHOLD.toFixed(2)}
              </p>
              <p className="mt-1 text-[11px] text-amber-200/70">
                ${(parsedAmount + SMALL_WITHDRAWAL_FEE).toFixed(2)} total will be deducted from your balance to send you ${parsedAmount.toFixed(2)}.
                Withdraw your full balance instead to avoid this fee.
              </p>
            </div>
          )
        )}
        <Button
          onClick={submit}
          disabled={!canSubmit}
          className="w-full h-12 rounded-xl gold-gradient text-black font-bold hover:opacity-90 disabled:opacity-30"
        >
          {busy ? (
            <><Loader2 size={16} className="animate-spin mr-2" /> Submitting...</>
          ) : bankReady ? (
            direction === "deposit" ? "Deposit to ChessBet wallet" : "Withdraw to bank"
          ) : (
            "Complete bank connection first"
          )}
        </Button>
        {direction === "withdrawal" && wallet && (
          <p className="text-[11px] text-white/30 text-center">
            Available: ${(wallet.available_balance || 0).toFixed(2)}
          </p>
        )}
        {error && (
          <p className="text-xs text-red-400 text-center flex items-center justify-center gap-1.5">
            <AlertTriangle size={13} /> {error}
          </p>
        )}
      </div>

      {/* Recent Seamless transactions */}
      {state?.recent?.length > 0 && (
        <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-4">
          <h4 className="text-xs uppercase tracking-widest text-white/40 mb-2">Pending & Recent Transfers</h4>
          <div className="divide-y divide-white/5">
            {state.recent.map((tx) => <TxRow key={tx.id} tx={tx} />)}
          </div>
        </div>
      )}
    </div>
  );
}
