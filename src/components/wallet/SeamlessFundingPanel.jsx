import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus, ArrowUpRight, Loader2, CheckCircle2, Clock, AlertTriangle,
  XCircle, Link2, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

// Seamless ACH funding panel. Replaces the former direct-Plaid-Link deposit/
// withdraw UI on the Wallet page. All real-money provider calls are gated
// server-side by EARLY_ACCESS_MODE and by verified-account checks; this UI
// only surfaces the resulting states (verified / pending / failed bank and
// payment). It never trusts the Seamless browser callback as verification —
// only the funding-source.verified webhook persists a verified source_id.

const BANK_STATUS = {
  verified: { label: "Verified", color: "text-emerald-400", icon: CheckCircle2 },
  pending_verification: { label: "Verifying", color: "text-amber-400", icon: Clock },
  added: { label: "Added", color: "text-white/50", icon: Clock },
  verification_failed: { label: "Verification failed", color: "text-red-400", icon: XCircle },
  verification_expired: { label: "Verification expired", color: "text-red-400", icon: XCircle },
  deleted: { label: "Removed", color: "text-white/40", icon: XCircle },
  error: { label: "Error", color: "text-red-400", icon: XCircle },
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
            {bank.account_mask ? ` ••••${bank.account_mask}` : ""}
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
          {isDeposit ? "+" : "−"}${Number(tx.amount || 0).toFixed(2)}
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
  const [direction, setDirection] = useState("deposit");
  const depositRequestKey = useRef("");
  const withdrawalRequestKey = useRef("");

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

  // Poll while any bank is still verifying or a Seamless tx is pending, so the
  // user sees the verified/pending/failed transition without a manual refresh.
  useEffect(() => {
    const hasPending =
      state?.banks?.some((b) => ["added", "pending_verification"].includes(b.status)) ||
      state?.recent?.some((t) => t.status === "pending");
    if (!hasPending) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [state, load]);

  const linkBank = async () => {
    setError(""); setBusy("linking");
    try {
      const { data: ensure } = await base44.functions.invoke("ensureSeamlessCustomer", {});
      if (!ensure?.enabled) throw new Error(ensure?.reason || "Bank linking is unavailable right now.");
      const { data: link } = await base44.functions.invoke("createSeamlessBankLinkUrl", {});
      if (!link?.enabled) throw new Error(link?.reason || "Could not start bank linking.");
      // Redirect to Seamless hosted bank authorization. The browser callback is
      // NOT verification — the funding-source.verified webhook is authoritative.
      window.location.href = link.url;
    } catch (e) {
      setError(e?.message || "Unable to start bank linking.");
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
    } catch (e) {
      setError(e?.message || "Unable to submit the transfer.");
    } finally {
      setBusy("");
    }
  };

  const earlyAccess = !!state?.early_access;
  const notVerified = accountState !== "verified";
  const ineligible = earlyAccess || withdrawalHold || notVerified;
  const verifiedBank = state?.banks?.find((b) => b.status === "verified");
  const canSubmit = !ineligible && !!verifiedBank && !busy && parseFloat(amount) > 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="animate-spin text-[#C9A84C]" size={22} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {earlyAccess && (
        <div className="rounded-2xl bg-amber-500/[0.06] border border-amber-500/20 p-4 text-center">
          <p className="text-sm text-amber-300/90 font-medium">
            Bank transfers are unavailable during Early Access.
          </p>
          <p className="text-xs text-amber-300/60 mt-1">
            Your demo balance is unchanged. Real deposits and withdrawals unlock at launch.
          </p>
        </div>
      )}

      {/* Account-state notices (preserved from the prior UX) */}
      {!earlyAccess && withdrawalHold && (
        <p className="text-xs text-red-400/80 text-center">
          Withdrawals are temporarily on hold while we complete a routine account review.
        </p>
      )}
      {!earlyAccess && !withdrawalHold && notVerified && accountState === "provisional" && (
        <p className="text-xs text-white/40 text-center">
          Complete identity verification to unlock deposits and withdrawals.
        </p>
      )}
      {!earlyAccess && !withdrawalHold && accountState === "suspended" && (
        <p className="text-xs text-red-400/80 text-center">
          Your account is currently suspended. Deposits and withdrawals are unavailable.
        </p>
      )}
      {!earlyAccess && !withdrawalHold && accountState === "closed" && (
        <p className="text-xs text-red-400/80 text-center">
          This account is closed. Deposits and withdrawals are unavailable.
        </p>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <Button
          onClick={() => setDirection("deposit")}
          className={`h-12 rounded-2xl font-bold disabled:opacity-30 ${
            direction === "deposit"
              ? "gold-gradient text-black"
              : "bg-white/[0.05] text-white/70 border border-white/10"
          }`}
          disabled={ineligible}
        >
          <Plus size={16} className="mr-2" /> Fund Account
        </Button>
        <Button
          onClick={() => setDirection("withdrawal")}
          disabled={ineligible || (wallet && (wallet.available_balance || 0) <= 0)}
          className={`h-12 rounded-2xl font-bold disabled:opacity-30 ${
            direction === "withdrawal"
              ? "gold-gradient text-black"
              : "bg-white/[0.05] text-white/70 border border-white/10"
          }`}
        >
          <ArrowUpRight size={16} className="mr-2" /> Withdraw Funds
        </Button>
      </div>

      {/* Bank accounts */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs uppercase tracking-widest text-white/40">Bank Accounts</h4>
          <Button
            variant="ghost"
            size="sm"
            onClick={linkBank}
            disabled={busy === "linking" || ineligible}
            className="text-xs text-[#C9A84C] hover:text-[#E8D48B] h-7 px-2 disabled:opacity-30"
          >
            {busy === "linking" ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
            <span className="ml-1">{busy === "linking" ? "Connecting…" : "Link bank"}</span>
          </Button>
        </div>
        {state?.banks?.length ? (
          state.banks.map((b) => <BankRow key={b.id} bank={b} />)
        ) : (
          <p className="text-xs text-white/30 text-center py-3">
            No bank accounts linked yet.
          </p>
        )}
      </div>

      {/* Amount input + submit (deposit/withdraw share one form) */}
      <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 space-y-3">
        <input
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={direction === "deposit" ? "Amount to fund" : "Amount to withdraw"}
          disabled={ineligible}
          className="w-full h-12 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/20 text-sm focus:border-[#C9A84C]/50 focus:outline-none disabled:opacity-40"
        />
        <Button
          onClick={submit}
          disabled={!canSubmit}
          className="w-full h-12 rounded-xl gold-gradient text-black font-bold hover:opacity-90 disabled:opacity-30"
        >
          {busy ? (
            <><Loader2 size={16} className="animate-spin mr-2" /> Submitting…</>
          ) : verifiedBank ? (
            direction === "deposit" ? "Fund via Seamless ACH" : "Withdraw via Seamless ACH"
          ) : (
            "Link & verify a bank first"
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