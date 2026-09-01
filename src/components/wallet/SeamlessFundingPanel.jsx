import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus, ArrowUpRight, Loader2, CheckCircle2, Clock, AlertTriangle,
  XCircle, Link2, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

// Seamless ACH funding panel. Replaces the former direct-Plaid-Link deposit/
// withdraw UI on the Wallet page. Real deposit calls require the server-side
// SEAMLESS_DEPOSITS_ENABLED switch; all bank actions require verified accounts. This UI
// only surfaces the resulting states (verified / pending / failed bank and
// payment). It never trusts the Seamless browser callback as verification ?
// only the funding-source.verified webhook persists a verified source_id.

const BANK_STATUS = {
  verified: { label: "Verified", color: "text-emerald-400", icon: CheckCircle2 },
  pending_verification: { label: "Verification in progress", color: "text-amber-400", icon: Clock },
  added: { label: "Connection submitted", color: "text-amber-400", icon: Clock },
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
  const s = BANK_STATUS[bank.status] || BANK_STATUS.added;
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
            {bank.account_mask ? ` ????${bank.account_mask}` : ""}
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
          {isDeposit ? "+" : "?"}${Number(tx.amount || 0).toFixed(2)}
        </span>
        <span className={`text-xs ${s.color}`}>{s.label}</span>
      </div>
    </div>
  );
}

export default function SeamlessFundingPanel({ wallet, accountState, withdrawalHold, onRefresh }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [direction, setDirection] = useState("deposit");
  const depositRequestKey = useRef("");
  const withdrawalRequestKey = useRef("");
  const pollAttempts = useRef(0);
  const query = new URLSearchParams(window.location.search);
  const bankLinkReturned = query.get("bank_link_return") === "1";
  const bankLinkCancelled = query.get("bank_link_cancelled") === "1";

  const load = useCallback(async () => {
    try {
      const { data } = await base44.functions.invoke("getSeamlessWalletState", {});
      setState(data);
      setError("");
    } catch (e) {
      setError(e?.message || "Unable to load funding status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll briefly after a hosted-flow return or while persisted state is pending.
  // Stop after ten inexpensive refreshes; later visits always reload server state.
  useEffect(() => {
    const hasPending =
      state?.banks?.some((b) => ["added", "pending_verification"].includes(b.status)) ||
      state?.recent?.some((t) => t.status === "pending") ||
      (bankLinkReturned && !!state?.profile && !state?.banks?.length);
    if (!hasPending || pollAttempts.current >= 10) return;
    const timer = setTimeout(() => {
      pollAttempts.current += 1;
      load();
    }, 8000);
    return () => clearTimeout(timer);
  }, [state, load, bankLinkReturned]);

  const linkBank = async () => {
    setError(""); setBusy("linking");
    try {
      const { data: ensure } = await base44.functions.invoke("ensureSeamlessCustomer", {});
      if (!ensure?.enabled) throw new Error(ensure?.reason || "Bank linking is unavailable right now.");
      const { data: link } = await base44.functions.invoke("createSeamlessBankLinkUrl", {});
      if (!link?.enabled) throw new Error(link?.reason || "Could not start bank linking.");
      // Redirect to Seamless hosted bank authorization. The browser callback is
      // NOT verification ? the funding-source.verified webhook is authoritative.
      window.location.href = link.url;
    } catch {
      setError("We couldn't start the secure bank connection. Please try again or contact support.");
    } finally {
      setBusy("");
    }
  };

  const screenBank = async () => {
    if (!verifiedBank?.source_id || !/^\d{9}$/.test(routingNumber) || !/^\d{4,34}$/.test(accountNumber)) {
      setError("Enter a valid 9-digit routing number and bank account number.");
      return;
    }
    setError(""); setBusy("screening");
    try {
      const { data } = await base44.functions.invoke("requestSocureBankVerification", {
        sourceId: verifiedBank.source_id,
        routingNumber,
        accountNumber,
      });
      if (!data?.enabled) throw new Error(data?.reason || "Bank screening is unavailable right now.");
      setRoutingNumber("");
      setAccountNumber("");
      await load();
      if (data?.verification?.status !== "completed" || data?.verification?.decision !== "ACCEPT") {
        setError("Your bank account needs review before transfers can be enabled.");
      }
    } catch (e) {
      const code = e?.response?.data?.error;
      setError(code === "funding_source_account_mismatch"
        ? "The account number does not match your connected bank."
        : "We couldn't complete bank screening. Please verify the details or contact support.");
    } finally {
      setBusy("");
    }
  };

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
    } catch {
      setError("We couldn't submit that request. Please try again or contact support.");
    } finally {
      setBusy("");
    }
  };

  const depositsEnabled = !!state?.deposits_enabled;
  const bankScreeningEnabled = !!state?.bank_screening_enabled;
  const identityVerified = !!state?.identity_verified;
  const effectiveAccountState = state?.account_state || accountState;
  const effectiveWithdrawalHold = state?.withdrawal_hold ?? withdrawalHold;
  const notVerified = !identityVerified || effectiveAccountState !== "verified";
  const ineligible = effectiveWithdrawalHold || notVerified;
  const verifiedBank = state?.banks?.find((b) => b.status === "verified");
  const pendingBank = state?.banks?.find((b) => ["added", "pending_verification"].includes(b.status));
  const attentionBank = state?.banks?.find((b) =>
    ["verification_failed", "verification_expired", "deleted", "error"].includes(b.status)
  );
  const bankScreeningStatus = verifiedBank?.socure_status || "not_started";
  const bankScreened = bankScreeningStatus === "verified";
  const canSubmit = !ineligible && !!verifiedBank && bankScreened && !busy && parseFloat(amount) > 0 && (direction !== 'deposit' || depositsEnabled);

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

      {/* Step 2: provider-persisted bank state is authoritative. */}
      <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[#C9A84C]">Step 2</p>
            <h4 className="text-sm font-semibold text-white mt-1">Connect a bank</h4>
            <p className="text-xs text-white/45 mt-1">
              {!identityVerified
                ? "Verify your identity before connecting a bank account."
                : verifiedBank
                  ? "Your bank account is connected and verified."
                  : attentionBank
                    ? "Your bank connection needs attention. Reconnect to try again."
                    : pendingBank
                      ? "We're confirming your bank connection. This status updates automatically."
                      : bankLinkCancelled
                        ? "Bank connection was cancelled. You can try again when ready."
                        : bankLinkReturned
                          ? "We're waiting for confirmation from your bank connection."
                          : "Securely connect the bank account you'll use with ChessBet."}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={linkBank}
            disabled={busy === "linking" || ineligible}
            className="text-xs text-[#C9A84C] hover:text-[#E8D48B] h-8 px-2 disabled:opacity-30 shrink-0"
          >
            {busy === "linking" ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
            <span className="ml-1">{busy === "linking" ? "Connecting?" : state?.banks?.length ? "Reconnect" : "Connect bank"}</span>
          </Button>
        </div>
        {state?.banks?.length ? (
          <div className="space-y-2">
            {state.banks.map((b) => <BankRow key={b.id} bank={b} />)}
          </div>
        ) : (
          <p className="text-xs text-white/30 text-center py-2">No confirmed bank connection yet.</p>
        )}
      </div>

      {/* Step 3: Socure Account Intelligence is bound to the verified Seamless source. */}
      {verifiedBank && (
        <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 space-y-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[#C9A84C]">Step 3</p>
            <h4 className="text-sm font-semibold text-white mt-1">Screen bank account</h4>
            <p className="text-xs text-white/45 mt-1">
              {bankScreened
                ? "Your connected bank passed account screening."
                : bankScreeningStatus === "processing"
                  ? "Bank screening is in progress."
                  : bankScreeningStatus === "review_required"
                    ? "Your bank account needs review before transfers can be enabled."
                    : bankScreeningStatus === "failed"
                      ? "Bank screening could not be completed. Contact support before trying again."
                      : bankScreeningEnabled
                        ? "Confirm the routing and account numbers for the bank you connected. ChessBet does not store these numbers."
                        : "Bank screening is temporarily unavailable."}
            </p>
          </div>
          {bankScreened ? (
            <div className="flex items-center gap-2 text-sm text-emerald-300">
              <CheckCircle2 size={16} /> Socure screening complete
            </div>
          ) : bankScreeningStatus === "not_started" && bankScreeningEnabled ? (
            <div className="space-y-3">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={routingNumber}
                onChange={(e) => setRoutingNumber(e.target.value.replace(/\D/g, "").slice(0, 9))}
                placeholder="9-digit routing number"
                className="w-full h-11 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/20 text-sm focus:border-[#C9A84C]/50 focus:outline-none"
              />
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 34))}
                placeholder="Bank account number"
                className="w-full h-11 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/20 text-sm focus:border-[#C9A84C]/50 focus:outline-none"
              />
              <Button
                onClick={screenBank}
                disabled={busy === "screening" || routingNumber.length !== 9 || accountNumber.length < 4}
                className="w-full h-10 rounded-xl gold-gradient text-black font-bold disabled:opacity-40"
              >
                {busy === "screening" ? <><Loader2 size={15} className="animate-spin mr-2" /> Screening…</> : "Verify bank details"}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {/* Step 4: existing server-side transfer gates remain authoritative. */}
      <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 space-y-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[#C9A84C]">Step 4</p>
          <h4 className="text-sm font-semibold text-white mt-1">Fund account</h4>
          <p className="text-xs text-white/45 mt-1">
            {!depositsEnabled
              ? "Account funding is temporarily unavailable."
              : !identityVerified
                ? "Complete identity verification first."
                : !verifiedBank
                  ? "Connect and verify a bank before funding your account."
                  : !bankScreened
                    ? "Complete bank account screening before transfers."
                    : "Your identity, bank connection, and screening are ready."}
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
            disabled={ineligible || !verifiedBank || !bankScreened || !depositsEnabled}
          >
            <Plus size={16} className="mr-2" /> Fund Account
          </Button>
          <Button
            onClick={() => setDirection("withdrawal")}
            disabled={ineligible || !verifiedBank || !bankScreened || (wallet && (wallet.available_balance || 0) <= 0)}
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
          disabled={ineligible || !verifiedBank || !bankScreened || (direction === 'deposit' && !depositsEnabled)}
          className="w-full h-12 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/20 text-sm focus:border-[#C9A84C]/50 focus:outline-none disabled:opacity-40"
        />
        <Button
          onClick={submit}
          disabled={!canSubmit}
          className="w-full h-12 rounded-xl gold-gradient text-black font-bold hover:opacity-90 disabled:opacity-30"
        >
          {busy ? (
            <><Loader2 size={16} className="animate-spin mr-2" /> Submitting?</>
          ) : verifiedBank && bankScreened ? (
            direction === "deposit" ? "Fund via Seamless ACH" : "Withdraw via Seamless ACH"
          ) : (
            "Connect & screen a bank first"
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
