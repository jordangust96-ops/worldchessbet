import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowUpRight, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import Logo from "@/components/Logo";
import DemoModeNotice from "@/components/DemoModeNotice";
import RestrictedModeBanner from "@/components/RestrictedModeBanner";
import TransactionHistory from "@/components/wallet/TransactionHistory";
import { useAuth } from "@/lib/AuthContext";
import { getBrowserGeolocation, getDeviceFingerprintHash } from "@/lib/deviceContext";
import { trackPixelEvent } from "@/lib/metaPixel";

const TX_PAGE_SIZE = 20;

export default function WalletPage() {
  const { jurisdictionStatus } = useAuth();
  const [wallet, setWallet] = useState(null);
  const [userId, setUserId] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [txPage, setTxPage] = useState(1);
  const [txTotalCount, setTxTotalCount] = useState(0);
  const [stats, setStats] = useState({ won: 0, lost: 0, wagered: 0 });
  const [loading, setLoading] = useState(true);
  const [depositAmount, setDepositAmount] = useState("");
  const [showDeposit, setShowDeposit] = useState(false);
  const [isProcessingDeposit, setIsProcessingDeposit] = useState(false);
  const [depositError, setDepositError] = useState("");
  const [withdrawalHold, setWithdrawalHold] = useState(false);
  const [accountState, setAccountState] = useState("verified");

  useEffect(() => {
    loadData();
  }, []);

  // Loads only the transactions needed for the given page, plus a lightweight
  // (ids-only) count of the full history for the "Showing X-Y of Z" label and
  // page count — never pulls the full transaction history into the browser.
  const loadTransactions = async (uid, page) => {
    const skip = (page - 1) * TX_PAGE_SIZE;
    const [txs, allIds] = await Promise.all([
      base44.entities.WalletTransaction.filter({ user_id: uid }, "-created_date", TX_PAGE_SIZE, skip),
      base44.entities.WalletTransaction.filter({ user_id: uid }, "-created_date", 5000, 0, ["id"]),
    ]);
    setTransactions(txs);
    setTxTotalCount(allIds.length);
    setTxPage(page);
  };

  const handleTxPageChange = (page) => {
    if (!userId) return;
    loadTransactions(userId, page);
  };

  const loadData = async () => {
    const me = await base44.auth.me();
    setUserId(me.id);
    setWithdrawalHold(!!me.withdrawal_hold);
    setAccountState(me.account_state || "verified");
    const wallets = await base44.entities.Wallet.filter({ user_id: me.id });
    if (wallets.length > 0) {
      setWallet(wallets[0]);
    } else {
      const w = await base44.entities.Wallet.create({
        user_id: me.id,
        balance: 0,
        total_wagered: 0,
        total_won: 0,
        total_deposited: 0,
        total_withdrawn: 0,
      });
      setWallet(w);
    }
    await loadTransactions(me.id, 1);

    // Won/Lost/Wagered are derived from completed matches only — the wallet's
    // total_won/total_wagered fields aren't reliably updated by settlement, so
    // these are computed straight from Match history for accuracy.
    const completedMatches = await base44.entities.Match.filter({ status: "completed" });
    const myMatches = completedMatches.filter(
      (m) => m.player1_id === me.id || m.player2_id === me.id
    );
    let won = 0;
    let lost = 0;
    let wagered = 0;
    myMatches.forEach((m) => {
      wagered += m.wager_amount || 0;
      if (m.result === "draw" || !m.winner_id) return;
      if (m.winner_id === me.id) {
        won += (m.wager_amount || 0) * 2 * 0.9;
      } else {
        lost += m.wager_amount || 0;
      }
    });
    setStats({ won, lost, wagered });

    setLoading(false);
  };

  // Called when the user confirms the amount. The actual balance update and
  // eligibility check both happen server-side in the depositFunds function —
  // the client never computes or sends a resulting balance.
  const confirmDeposit = async () => {
    const requestedAmount = parseFloat(depositAmount);
    if (!requestedAmount || requestedAmount <= 0 || !wallet) return;

    setIsProcessingDeposit(true);
    setDepositError("");
    try {
      trackPixelEvent("Deposit Initiated", { value: requestedAmount, currency: "USD" });
      // Secondary, non-authoritative signals for fraud/forensic logging only —
      // requested right before this paid action, never gating it either way.
      const geo = await getBrowserGeolocation();
      const deviceFingerprintHash = await getDeviceFingerprintHash();
      const { data } = await base44.functions.invoke("depositFunds", {
        amount: requestedAmount,
        browserGeoPermission: geo.permission,
        browserLatitude: geo.latitude,
        browserLongitude: geo.longitude,
        browserAccuracyMeters: geo.accuracyMeters,
        deviceFingerprintHash,
      });
      if (data?.eligible) {
        trackPixelEvent("Deposit Completed", { value: requestedAmount, currency: "USD" });
        setDepositAmount("");
        setShowDeposit(false);
        loadData();
      } else {
        setDepositError(data?.reason || data?.error || "You're not currently eligible to fund your account.");
      }
    } finally {
      setIsProcessingDeposit(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-[#C9A84C]" size={28} />
      </div>
    );
  }

  return (
    <div className="min-h-screen px-5 pt-8">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-6"
      >
        <Link to="/" className="inline-block">
          <Logo size="sm" />
        </Link>
        <DemoModeNotice />
        <RestrictedModeBanner />

        {/* Balance Card */}
        <div className="rounded-3xl bg-gradient-to-br from-[#1A1A1A] to-[#111] border border-white/5 p-6 text-center">
          <p className="text-xs uppercase tracking-widest text-white/40 mb-2">Total Balance</p>
          <h1 className="text-4xl font-extrabold text-white mb-1">
            ${wallet?.balance?.toFixed(2)}
          </h1>
          <div className="flex items-center justify-center gap-6 mt-4">
            <div>
              <p className="text-[10px] text-white/30 uppercase">Won</p>
              <p className="text-sm font-bold text-[#C9A84C]">${stats.won.toFixed(2)}</p>
            </div>
            <div className="w-px h-6 bg-white/10" />
            <div>
              <p className="text-[10px] text-white/30 uppercase">Lost</p>
              <p className="text-sm font-bold text-red-400">${stats.lost.toFixed(2)}</p>
            </div>
            <div className="w-px h-6 bg-white/10" />
            <div>
              <p className="text-[10px] text-white/30 uppercase">Entered</p>
              <p className="text-sm font-bold text-white/60">${stats.wagered.toFixed(2)}</p>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            onClick={() => setShowDeposit(!showDeposit)}
            disabled={jurisdictionStatus && jurisdictionStatus !== "approved"}
            className="h-12 rounded-2xl gold-gradient text-black font-bold hover:opacity-90 disabled:opacity-30"
          >
            <Plus size={16} className="mr-2" /> Fund Account
          </Button>
          <Button
            variant="outline"
            disabled={withdrawalHold || accountState !== "verified"}
            className="h-12 rounded-2xl border-white/10 text-white/70 font-bold hover:bg-white/5 disabled:opacity-40"
          >
            <ArrowUpRight size={16} className="mr-2" /> Withdraw Funds
          </Button>
        </div>
        {withdrawalHold && (
          <p className="text-xs text-red-400/80 text-center -mt-2">
            Withdrawals are temporarily on hold while we complete a routine account review.
          </p>
        )}
        {!withdrawalHold && accountState === "provisional" && (
          <p className="text-xs text-white/40 text-center -mt-2">
            Complete identity verification to unlock deposits and withdrawals.
          </p>
        )}
        {!withdrawalHold && accountState === "suspended" && (
          <p className="text-xs text-red-400/80 text-center -mt-2">
            Your account is currently suspended. Deposits and withdrawals are unavailable.
          </p>
        )}
        {!withdrawalHold && accountState === "closed" && (
          <p className="text-xs text-red-400/80 text-center -mt-2">
            This account is closed. Deposits and withdrawals are unavailable.
          </p>
        )}

        {/* Deposit Input */}
        {showDeposit && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 space-y-3"
          >
            <input
              type="number"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="Enter amount"
              className="w-full h-12 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/20 text-sm focus:border-[#C9A84C]/50 focus:outline-none"
            />
            <Button
              onClick={confirmDeposit}
              disabled={!depositAmount || parseFloat(depositAmount) <= 0 || isProcessingDeposit}
              className="w-full h-12 rounded-xl gold-gradient text-black font-bold hover:opacity-90 disabled:opacity-30"
            >
              {isProcessingDeposit ? "Confirming..." : "Confirm Funding"}
            </Button>
            {depositError && (
              <p className="text-xs text-red-400 text-center">{depositError}</p>
            )}
          </motion.div>
        )}

        {/* Transactions */}
        <div>
          <h3 className="text-sm font-semibold text-white/70 mb-4">Transaction History</h3>
          <TransactionHistory
            transactions={transactions}
            page={txPage}
            pageSize={TX_PAGE_SIZE}
            totalCount={txTotalCount}
            onPageChange={handleTxPageChange}
          />
        </div>
      </motion.div>
    </div>
  );
}