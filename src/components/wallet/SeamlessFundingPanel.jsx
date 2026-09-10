import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus, Loader2, CheckCircle2, Clock, AlertTriangle,
  XCircle, Link2, Trash2, Check, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { base44 } from "@/api/base44Client";
import { evaluateJurisdictionAccess } from "@/lib/jurisdictionAccess";
import SeamlessPlaidBankLink from "./SeamlessPlaidBankLink";
import SocureIdentityStep from "./SocureIdentityStep";

// Seamless ACH funding panel. Bank credentials are collected only inside the
// Seamless-hosted Plaid flow. Verification, deposits, and withdrawals remain
// independently controlled by server-side state and provider webhooks.

const BANK_STATUS = {
  verified: { label: "Connected", color: "text-emerald-400", icon: CheckCircle2 },
  pending_verification: { label: "Awaiting verification", color: "text-amber-400", icon: Clock },
  added: { label: "Awaiting verification", color: "text-amber-400", icon: Clock },
  verification_failed: { label: "Needs attention", color: "text-red-400", icon: XCircle },
  verification_expired: { label: "Reconnect required", color: "text-red-400", icon: XCircle },
  deleted: { label: "Removed", color: "text-white/40", icon: XCircle },
  error: { label: "Needs attention", color: "text-red-400", icon: XCircle },
};

function BankRow({ bank, busy, onMakePrimary, onDisconnect }) {
  const s = BANK_STATUS[bank.status] || BANK_STATUS.added;
  const Icon = s.icon;
  const isVerified = bank.status === "verified";
  const canDisconnect = bank.status !== "deleted";
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/5 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
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
              <span className="text-[10px] uppercase tracking-wider text-[#C9A84C]">
                {isVerified ? "Primary" : "Selected · awaiting verification"}
              </span>
            )}
          </div>
        </div>
        <span className={`flex items-center gap-1.5 text-xs font-medium ${s.color} shrink-0`}>
          <Icon size={14} /> {s.label}
        </span>
      </div>
      {canDisconnect && (
        <div className="mt-3 flex justify-end gap-2 border-t border-white/5 pt-3">
          {isVerified && !bank.is_primary && (
            <button
              type="button"
              onClick={() => onMakePrimary(bank)}
              disabled={!!busy}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/65 hover:border-[#C9A84C]/40 hover:text-[#C9A84C] disabled:opacity-40"
            >
              {busy === `primary:${bank.id}` ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              Use this bank
            </button>
          )}
          <button
            type="button"
            onClick={() => onDisconnect(bank)}
            disabled={!!busy}
            className="flex items-center gap-1.5 rounded-lg border border-red-500/20 px-3 py-1.5 text-xs text-red-300/75 hover:border-red-400/40 hover:text-red-300 disabled:opacity-40"
          >
            {busy === `disconnect:${bank.id}` ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

export default function SeamlessFundingPanel({
  wallet,
  jurisdictionDecision,
  accountState,
  withdrawalHold,
  onRefresh,
}) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [locationOverride, setLocationOverride] = useState(null);
  const [checkingLocation, setCheckingLocation] = useState(false);
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState("deposit");
  const [showBankManager, setShowBankManager] = useState(false);
  const [showBankLink, setShowBankLink] = useState(false);
  const [bankToDisconnect, setBankToDisconnect] = useState(null);
  const depositRequestKey = useRef("");
  const withdrawalRequestKey = useRef("");
  const pollAttempts = useRef(0);
  const load = useCallback(async () => {
    try {
      let syncUnavailable = false;
      try { await base44.functions.invoke("refreshSocureIdentityVerification", {}); }
      catch { syncUnavailable = true; }
      const { data } = await base44.functions.invoke("getSeamlessWalletState", {});
      if (data?.identity) data.identity.sync_unavailable = syncUnavailable;
      setState(data);
      setLoadError(false);
      return data;
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Keep the open wallet current while a bank transfer is processing or a
  // processed deposit is in its clearing window. The backend remains the
  // authoritative 15-minute monitor even when this page is closed.
  useEffect(() => {
    const hasPending = loadError ||
      ["pending", "incomplete", "review_required"].includes(state?.identity?.status) ||
      state?.banks?.some((b) => ["added", "pending_verification"].includes(b.status)) ||
      state?.recent?.some((t) => t.status === "pending" || t.deposit_hold_status === "held");
    if (!hasPending) {
      pollAttempts.current = 0;
      return;
    }
    if (pollAttempts.current >= 120) return;
    const timer = setTimeout(async () => {
      pollAttempts.current += 1;
      const before = JSON.stringify(state?.recent || []);
      const next = await load();
      const after = JSON.stringify(next?.recent || []);
      if ((before !== after || state?.identity?.status !== next?.identity?.status) && onRefresh) await onRefresh();
    }, state?.identity?.status === "pending" && pollAttempts.current < 24 ? 5000 : 30000);
    return () => clearTimeout(timer);
  }, [state, loadError, load, onRefresh]);

  const submit = async () => {
    const v = parseFloat(amount);
    if (!v || v <= 0 || !wallet) return;
    if (busy) return;
    setError(""); setNotice(""); setBusy(direction);
    try {
      const fn = direction === "deposit" ? "submitSeamlessDeposit" : "submitSeamlessWithdrawal";
      const payload = { amount: v, ...(direction === "deposit" ? {bankSourceId:providerPrimaryBank?.source_id} : {}) };
      const requestKey = direction === "deposit" ? depositRequestKey : withdrawalRequestKey;
      requestKey.current ||= crypto.randomUUID();
      payload.idempotencyKey = requestKey.current;
      const { data } = await base44.functions.invoke(fn, payload);
      if (!data?.enabled) throw new Error(data?.reason || "Bank transfers are unavailable right now.");
      // Preserve the key for an in-doubt provider result: pressing submit again
      // asks the server for the same logical transfer, never a second ACH request.
      if (data?.status !== "uncertain") requestKey.current = "";
      if (data?.status !== "uncertain") setAmount("");
      setNotice(data?.status === "uncertain" ? "Your bank has not confirmed this request yet. Do not submit another transfer; check Transaction History for updates." : direction === "deposit" ? "Deposit requested. Funds become available after processing and clearing. Follow its progress in Transaction History." : "Withdrawal requested. Follow its progress in Transaction History.");
      await load();
      if (onRefresh) onRefresh();
    } catch (e) {
      if (e?.response?.data?.action === "location_required") setLocationOverride({allowed:false,reason:e.response.data.error});
      if (e?.response?.data?.request_terminal === true) {
        (direction === "deposit" ? depositRequestKey : withdrawalRequestKey).current = "";
      }
      const serverMessage = e?.response?.data?.error;
      const message = typeof serverMessage === "string" && serverMessage
        ? serverMessage
        : "We couldn't submit that request. Please try again or contact support.";
      // Reload the durable transaction so an immediate provider decline appears
      // in both the compact transfer list and full Transaction History.
      try {
        await load();
        if (onRefresh) await onRefresh();
      } catch { /* Preserve the original transfer error below. */ }
      setError(message);
    } finally {
      setBusy("");
    }
  };

  const manageBank = async (action, bank) => {
    const busyKey = action === "set_primary" ? `primary:${bank.id}` : `disconnect:${bank.id}`;
    setBusy(busyKey);
    setError("");
    try {
      await base44.functions.invoke("manageSeamlessBankAccount", {
        action,
        bankId: bank.id,
      });
      setBankToDisconnect(null);
      await load();
      if (onRefresh) onRefresh();
    } catch (e) {
      const serverMessage = e?.response?.data?.error;
      setError(typeof serverMessage === "string" && serverMessage
        ? serverMessage
        : "We couldn't update that bank account. Please try again.");
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

  const location = locationOverride || jurisdictionDecision;
  const locationApproved = location?.allowed === true;
  const depositsEnabled = !!state?.deposits_enabled && locationApproved;
  const withdrawalsEnabled = !!state?.withdrawals_enabled;
  const hostedPlaidEnabled = !!state?.hosted_plaid_enabled;
  const accountVerified = !!state?.account_verified;
  const effectiveAccountState = state?.account_state || accountState;
  const effectiveWithdrawalHold = state?.withdrawal_hold ?? withdrawalHold;
  const accountRestricted = ["suspended", "closed"].includes(effectiveAccountState);
  const notVerified = !accountVerified || effectiveAccountState !== "verified";
  const ineligible = effectiveWithdrawalHold || accountRestricted || notVerified;
  const providerPrimaryBank = state?.banks?.find((b) => b.is_primary) || null;
  const verifiedBank =
    state?.banks?.find((b) => b.status === "verified" && b.is_primary) ||
    state?.banks?.find((b) => b.status === "verified");
  const bankPending = state?.banks?.some((b) =>
    ["added", "pending_verification"].includes(b.status)
  );
  const bankReady = !!verifiedBank;
  const depositSourceReady = providerPrimaryBank?.status === "verified";
  const bankReadyForDirection = direction === "deposit" ? depositSourceReady : bankReady;
  const displayedBank = direction === "deposit" ? (providerPrimaryBank || verifiedBank) : verifiedBank;
  const displayedBankVerified = displayedBank?.status === "verified";
  const transferDirectionEnabled = direction === "deposit" ? depositsEnabled : withdrawalsEnabled;
  const availableBalance = wallet?.available_balance || 0;
  const meetsMinimum = direction === "deposit" ? parsedAmount >= MIN_DEPOSIT_AMOUNT : parsedAmount > 0;
  const exceedsAvailableBalance = direction === "withdrawal" && parsedAmount > availableBalance + 0.005;
  const canSubmit =
    !ineligible && bankReadyForDirection && !busy && Number.isFinite(parsedAmount) && /^\d+(?:\.\d{1,2})?$/.test(amount) && (direction !== "deposit" || parsedAmount <= 10000) && meetsMinimum && !exceedsAvailableBalance && transferDirectionEnabled;
  const transferBusy = busy === direction;
  const formattedAmount = Number.isFinite(parsedAmount) && parsedAmount > 0
    ? parsedAmount.toFixed(2)
    : "";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="animate-spin text-[#C9A84C]" size={22} />
      </div>
    );
  }

  if (loadError) return (
    <div role="alert" className="rounded-3xl border border-amber-500/20 bg-white/[0.03] p-5 space-y-3">
      <h4 className="font-semibold text-white">Unable to refresh your wallet</h4>
      <p className="text-sm text-white/60">We could not confirm your latest bank and identity status. Transfers are paused on this screen until we reconnect. If you just submitted a transfer, check Transaction History once we reconnect before trying again.</p>
      <Button onClick={() => { setLoading(true); load(); }} className="gold-gradient text-black">Retry wallet connection</Button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5" aria-label="Location verification">
        <h3 className="text-base font-semibold text-white">{locationApproved ? "Location verified" : "Verify your location"}</h3>
        {!locationApproved && <><p className="mt-1 text-sm text-white/60">{location?.reason || "Location verification is required before funding."}</p>
          <button type="button" disabled={checkingLocation} className="mt-3 rounded-xl gold-gradient px-4 py-3 text-black disabled:opacity-40" onClick={async () => {
            setCheckingLocation(true);
            try {
              const {data} = await base44.functions.invoke("getCurrentJurisdiction",{triggerEvent:"bank_verification_start"});
              setLocationOverride(evaluateJurisdictionAccess(data));
            } catch { setLocationOverride({allowed:false,reason:"Location could not be verified. Please try again."}); }
            finally { setCheckingLocation(false); }
          }}>{checkingLocation ? "Checking location…" : "Verify location"}</button></>}
      </section>
      <SocureIdentityStep identity={{...state?.identity,can_start:state?.identity?.can_start && locationApproved}} onRefresh={load} />

      {/* Provider webhooks are authoritative for account and bank status. */}
      {effectiveWithdrawalHold && (
        <p className="text-xs text-red-400/80 text-center">
          Withdrawals are temporarily on hold while we complete a routine account review.
        </p>
      )}
      {!effectiveWithdrawalHold && notVerified && effectiveAccountState === "provisional" && (
        <p className="text-xs text-white/40 text-center">
          {["pending", "review_required"].includes(state?.identity?.status) ? "Transfers will unlock after your identity is approved." : state?.identity?.status === "rejected" ? "Verification was not approved. Contact support for next steps." : "Complete identity verification to unlock transfers."} Your connected banks stay linked.
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

      {/* Bank connection is a one-time prerequisite. Once verified, funding becomes the focus. */}
      {!bankReady && (
        <div className="rounded-3xl border border-white/5 bg-white/[0.03] p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#C9A84C]/15 text-sm font-bold text-[#C9A84C]">
              2
            </div>
            <div>
              <h4 className="text-base font-semibold text-white">Connect your bank</h4>
              <p className="mt-1 text-xs leading-relaxed text-white/45">
                {bankPending
                  ? "Your bank is being verified. This page will update automatically when it is ready."
                  : !hostedPlaidEnabled
                    ? "Secure bank connection is temporarily unavailable."
                    : "Securely link the checking account you want to use. ChessBet never sees or stores your bank login."}
              </p>
            </div>
          </div>

          {state?.banks?.length > 0 && (
            <div className="space-y-2">
              {state.banks.map((bank) => (
                <BankRow
                  key={bank.id}
                  bank={bank}
                  busy={busy}
                  onMakePrimary={(selected) => manageBank("set_primary", selected)}
                  onDisconnect={setBankToDisconnect}
                />
              ))}
            </div>
          )}

          {!bankPending && hostedPlaidEnabled && !accountRestricted && accountVerified && (locationApproved || availableBalance > 0) ? (
            <SeamlessPlaidBankLink
              legalName={state?.legal_name || ""}
              hasWithdrawableBalance={availableBalance > 0}
              disabled={effectiveWithdrawalHold || !accountVerified || (!locationApproved && availableBalance <= 0)}
              onComplete={load}
            />
          ) : !bankPending ? (
            <p className="py-2 text-center text-xs text-white/30">No bank connected yet.</p>
          ) : null}
        </div>
      )}

      {bankReady && (
        <div className="overflow-hidden rounded-3xl border border-white/5 bg-gradient-to-b from-white/[0.045] to-white/[0.02]">
          <div className="space-y-5 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C9A84C]">
                  ChessBet wallet
                </p>
                <h4 className="mt-1 text-xl font-bold text-white">
                  {direction === "deposit" ? "Add money" : "Withdraw funds"}
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-white/45">
                  {direction === "deposit"
                    ? "Choose an amount and add it securely from your connected bank."
                    : "Send available wallet funds back to your connected bank."}
                </p>
              </div>

              <div
                role="group"
                aria-label="Choose a transfer type"
                className="grid grid-cols-2 rounded-xl border border-white/10 bg-black/20 p-1"
              >
                <button
                  type="button"
                  aria-pressed={direction === "deposit"}
                  onClick={() => {
                    setDirection("deposit");
                    setAmount("");
                    setError("");
                  }}
                  disabled={!depositsEnabled || ineligible}
                  className={
                    "rounded-lg px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-30 " +
                    (direction === "deposit"
                      ? "bg-[#C9A84C] text-black"
                      : "text-white/55 hover:text-white")
                  }
                >
                  Add money
                </button>
                <button
                  type="button"
                  aria-pressed={direction === "withdrawal"}
                  onClick={() => {
                    setDirection("withdrawal");
                    setAmount("");
                    setError("");
                  }}
                  disabled={!withdrawalsEnabled || ineligible || availableBalance <= 0}
                  className={
                    "rounded-lg px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-30 " +
                    (direction === "withdrawal"
                      ? "bg-[#C9A84C] text-black"
                      : "text-white/55 hover:text-white")
                  }
                >
                  Withdraw
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-white/5 bg-black/20 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${displayedBankVerified ? "bg-emerald-500/10" : "bg-amber-500/10"}`}>
                    {displayedBankVerified
                      ? <CheckCircle2 size={17} className="text-emerald-400" />
                      : <Clock size={17} className="text-amber-400" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-white/35">
                      {direction === "deposit" ? "From" : "To"}
                    </p>
                    <p className="truncate text-sm font-medium text-white/85">
                      {displayedBank?.account_name || "Connected bank"}
                      {displayedBank?.account_mask ? " ending in " + displayedBank.account_mask : ""}
                    </p>
                    <p className={`text-[10px] ${displayedBankVerified ? "text-emerald-400/75" : "text-amber-300/75"}`}>
                      {displayedBankVerified ? "Connected" : "Awaiting verification"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-expanded={showBankManager}
                  onClick={() => {
                    setShowBankManager((value) => !value);
                    if (showBankManager) setShowBankLink(false);
                  }}
                  disabled={!!busy}
                  className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#C9A84C] hover:bg-[#C9A84C]/10 disabled:opacity-40"
                >
                  {showBankManager ? "Done" : "Manage"}
                </button>
              </div>

              {direction === "deposit" && !depositSourceReady && (
                <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] p-3">
                  <p className="text-xs leading-relaxed text-amber-100/80">
                    {providerPrimaryBank?.account_name || "Your selected bank"} is still awaiting verification and cannot be used for another deposit yet.
                  </p>
                  {verifiedBank && !verifiedBank.is_primary && (
                    <button
                      type="button"
                      onClick={() => manageBank("set_primary", verifiedBank)}
                      disabled={!!busy}
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#E7C866] hover:underline disabled:opacity-40"
                    >
                      {busy === `primary:${verifiedBank.id}` ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      Use {verifiedBank.account_name || "connected bank"} for deposits
                    </button>
                  )}
                </div>
              )}

              {showBankManager && (
                <div className="mt-4 space-y-3 border-t border-white/5 pt-4">
                  <div className="space-y-2">
                    {state.banks.map((bank) => (
                      <BankRow
                        key={bank.id}
                        bank={bank}
                        busy={busy}
                        onMakePrimary={(selected) => manageBank("set_primary", selected)}
                        onDisconnect={setBankToDisconnect}
                      />
                    ))}
                  </div>

                  {hostedPlaidEnabled && !accountRestricted && accountVerified && (locationApproved || availableBalance > 0) && (
                    <button
                      type="button"
                      onClick={() => setShowBankLink((value) => !value)}
                      disabled={!!busy || effectiveWithdrawalHold}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-xs font-medium text-white/60 hover:border-[#C9A84C]/40 hover:text-[#C9A84C] disabled:opacity-40"
                    >
                      {showBankLink ? <ChevronUp size={14} /> : <Plus size={14} />}
                      {showBankLink ? "Close bank connection form" : "Change or add a bank account"}
                    </button>
                  )}

                  {showBankLink && hostedPlaidEnabled && !accountRestricted && accountVerified && (locationApproved || availableBalance > 0) && (
                    <SeamlessPlaidBankLink
                      legalName={state?.legal_name || ""}
                      hasWithdrawableBalance={availableBalance > 0}
                      disabled={effectiveWithdrawalHold || !accountVerified || (!locationApproved && availableBalance <= 0)}
                      onComplete={async () => {
                        setShowBankLink(false);
                        await load();
                      }}
                    />
                  )}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <label htmlFor="wallet-transfer-amount" className="block text-xs font-medium text-white/60">
                Amount
              </label>
              <div className="flex h-16 items-center rounded-2xl border border-white/10 bg-black/25 px-4 focus-within:border-[#C9A84C]/60">
                <span className="text-2xl font-semibold text-white/35">$</span>
                <input
                  id="wallet-transfer-amount"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  disabled={ineligible || !bankReadyForDirection || !transferDirectionEnabled}
                  className="h-full min-w-0 flex-1 bg-transparent px-2 text-2xl font-bold text-white outline-none placeholder:text-white/15 disabled:opacity-40"
                />
                <span className="text-xs font-medium text-white/30">USD</span>
              </div>

              {direction === "deposit" && (
                <>
                  <div className="grid grid-cols-4 gap-2" aria-label="Quick deposit amounts">
                    {[10, 25, 50, 100].map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={parsedAmount === value}
                        onClick={() => setAmount(String(value))}
                        disabled={ineligible || !depositSourceReady || !depositsEnabled || !!busy}
                        className={
                          "rounded-xl border px-2 py-2.5 text-sm font-semibold transition-colors disabled:opacity-30 " +
                          (parsedAmount === value
                            ? "border-[#C9A84C]/60 bg-[#C9A84C]/10 text-[#E7C866]"
                            : "border-white/10 bg-white/[0.025] text-white/60 hover:border-white/20 hover:text-white")
                        }
                      >
                        ${value}
                      </button>
                    ))}
                  </div>
                  <p className="text-center text-[11px] text-white/30">
                    ${MIN_DEPOSIT_AMOUNT.toFixed(2)} minimum deposit
                  </p>
                </>
              )}

              {direction === "withdrawal" && availableBalance > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(String(availableBalance.toFixed(2)))}
                  disabled={ineligible || !withdrawalsEnabled || !!busy}
                  className="w-full text-center text-xs font-medium text-[#C9A84C] hover:underline disabled:opacity-40"
                >
                  Withdraw full balance (${availableBalance.toFixed(2)}) — no fee
                </button>
              )}

              {exceedsAvailableBalance && (
                <p className="text-center text-xs text-red-400">
                  Enter an amount no greater than your ${availableBalance.toFixed(2)} available balance.
                </p>
              )}

              {direction === "withdrawal" && parsedAmount > 0 && parsedAmount < SMALL_WITHDRAWAL_THRESHOLD && !exceedsAvailableBalance && (
                isFullBalanceWithdrawal ? (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2.5 text-center">
                    <p className="text-xs font-medium text-emerald-300">No fee — you're withdrawing your full balance</p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5 text-center">
                    <p className="text-xs font-semibold text-amber-300">
                      ${SMALL_WITHDRAWAL_FEE.toFixed(2)} fee applies below ${SMALL_WITHDRAWAL_THRESHOLD.toFixed(2)}
                    </p>
                    <p className="mt-1 text-[11px] text-amber-200/70">
                      ${(parsedAmount + SMALL_WITHDRAWAL_FEE).toFixed(2)} will leave your wallet to send ${parsedAmount.toFixed(2)}.
                    </p>
                  </div>
                )
              )}

              <Button
                onClick={submit}
                disabled={!canSubmit}
                className="w-full rounded-2xl gold-gradient py-3.5 text-sm font-bold text-black hover:opacity-90 disabled:opacity-30"
              >
                {transferBusy ? (
                  <><Loader2 size={16} className="mr-2 animate-spin" /> Processing securely...</>
                ) : notVerified ? (["pending", "review_required"].includes(state?.identity?.status) ? "Awaiting identity approval" : state?.identity?.status === "rejected" ? "Verification not approved" : "Verify your identity first") : direction === "deposit" ? (
                  !depositsEnabled
                    ? (!locationApproved ? "Verify your location first" : "Deposits are temporarily unavailable")
                    : !depositSourceReady
                      ? "Choose a connected bank"
                    : !formattedAmount
                      ? "Enter an amount"
                      : !meetsMinimum
                        ? "Minimum deposit is $" + MIN_DEPOSIT_AMOUNT.toFixed(2)
                        : "Add $" + formattedAmount + " to wallet"
                ) : (
                  !withdrawalsEnabled
                    ? "Withdrawals are temporarily unavailable"
                    : !formattedAmount
                      ? "Enter an amount"
                      : exceedsAvailableBalance
                        ? "Amount exceeds available balance"
                        : "Withdraw $" + formattedAmount + " to bank"
                )}
              </Button>

              <p className="text-center text-[11px] leading-relaxed text-white/25">
                Secure bank transfer via Seamless. Your bank login is never shared with ChessBet.
              </p>
            </div>
          </div>
        </div>
      )}

      {notice && <p role="status" className="text-center text-sm text-[#C9A84C]">{notice}</p>}
      {error && (
        <p role="alert" className="flex items-center justify-center gap-1.5 text-center text-xs text-red-400">
          <AlertTriangle size={13} /> {error}
        </p>
      )}

      <AlertDialog
        open={!!bankToDisconnect}
        onOpenChange={(open) => !open && setBankToDisconnect(null)}
      >
        <AlertDialogContent className="border-white/10 bg-[#151515] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect this bank account?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/55">
              ChessBet will remove the account from Seamless and revoke its ACH authorization.
              You can reconnect this bank or add a different bank later. A bank with a transfer
              in progress cannot be disconnected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-transparent text-white hover:bg-white/5">
              Keep connected
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bankToDisconnect && manageBank("disconnect", bankToDisconnect)}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              Disconnect bank
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
