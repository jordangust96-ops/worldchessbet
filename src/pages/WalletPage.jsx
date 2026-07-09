import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight, ArrowDownLeft, Loader2, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import moment from "moment";
import { runEligibilityPipeline } from "@/lib/eligibilityPipeline";

export default function WalletPage() {
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [stats, setStats] = useState({ won: 0, lost: 0, wagered: 0 });
  const [loading, setLoading] = useState(true);
  const [depositAmount, setDepositAmount] = useState("");
  const [showDeposit, setShowDeposit] = useState(false);
  const [isProcessingDeposit, setIsProcessingDeposit] = useState(false);
  const [depositError, setDepositError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const me = await base44.auth.me();
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
    const txs = await base44.entities.WalletTransaction.filter(
      { user_id: me.id },
      "-created_date",
      20
    );
    setTransactions(txs);

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

  // Executes the deposit itself. This function is only ever called once the
  // eligibility pipeline has resolved successfully — it has no knowledge of
  // identity verification or geolocation.
  const handleDeposit = async (amount) => {
    if (!amount || amount <= 0 || !wallet) return;
    await base44.entities.Wallet.update(wallet.id, {
      balance: wallet.balance + amount,
      total_deposited: (wallet.total_deposited || 0) + amount,
    });
    await base44.entities.WalletTransaction.create({
      user_id: wallet.user_id,
      type: "deposit",
      amount,
      description: "Deposit to wallet",
    });
    setDepositAmount("");
    setShowDeposit(false);
    loadData();
  };

  // Called when the user confirms the amount. Holds the requested amount in
  // a deposit session while the eligibility pipeline runs, then hands off to
  // handleDeposit() only if the pipeline succeeds.
  const confirmDeposit = async () => {
    const requestedAmount = parseFloat(depositAmount);
    if (!requestedAmount || requestedAmount <= 0 || !wallet) return;

    setIsProcessingDeposit(true);
    setDepositError("");
    try {
      const { eligible, reason } = await runEligibilityPipeline(wallet.user_id, requestedAmount);
      if (eligible) {
        await handleDeposit(requestedAmount);
      } else {
        setDepositError(reason || "You're not currently eligible to deposit.");
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

  const typeConfig = {
    deposit: { icon: ArrowDownLeft, color: "text-green-400", bg: "bg-green-500/10", label: "Deposit" },
    withdrawal: { icon: ArrowUpRight, color: "text-red-400", bg: "bg-red-500/10", label: "Withdrawal" },
    wager_lock: { icon: Minus, color: "text-orange-400", bg: "bg-orange-500/10", label: "Wager Locked" },
    wager_refund: { icon: Plus, color: "text-blue-400", bg: "bg-blue-500/10", label: "Wager Refund" },
    payout: { icon: ArrowDownLeft, color: "text-[#C9A84C]", bg: "bg-[#C9A84C]/10", label: "Payout" },
  };

  return (
    <div className="min-h-screen px-5 pt-8">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-6"
      >
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
              <p className="text-[10px] text-white/30 uppercase">Wagered</p>
              <p className="text-sm font-bold text-white/60">${stats.wagered.toFixed(2)}</p>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            onClick={() => setShowDeposit(!showDeposit)}
            className="h-12 rounded-2xl gold-gradient text-black font-bold hover:opacity-90"
          >
            <Plus size={16} className="mr-2" /> Deposit
          </Button>
          <Button
            variant="outline"
            className="h-12 rounded-2xl border-white/10 text-white/70 font-bold hover:bg-white/5"
          >
            <ArrowUpRight size={16} className="mr-2" /> Withdraw
          </Button>
        </div>

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
              {isProcessingDeposit ? "Confirming..." : "Confirm Deposit"}
            </Button>
            {depositError && (
              <p className="text-xs text-red-400 text-center">{depositError}</p>
            )}
          </motion.div>
        )}

        {/* Transactions */}
        <div>
          <h3 className="text-sm font-semibold text-white/70 mb-4">Transaction History</h3>
          {transactions.length === 0 ? (
            <div className="text-center py-10 rounded-2xl bg-white/[0.02] border border-white/5">
              <p className="text-white/30 text-sm">No transactions yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {transactions.map((tx) => {
                const config = typeConfig[tx.type] || typeConfig.deposit;
                const Icon = config.icon;
                const isIncoming = ["deposit", "payout", "wager_refund"].includes(tx.type);
                return (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/5"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${config.bg}`}>
                        <Icon size={16} className={config.color} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{config.label}</p>
                        <p className="text-[11px] text-white/30">
                          {moment(tx.created_date).fromNow()}
                        </p>
                      </div>
                    </div>
                    <p className={`text-sm font-bold ${isIncoming ? "text-green-400" : "text-red-400"}`}>
                      {isIncoming ? "+" : "-"}${tx.amount?.toFixed(2)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}