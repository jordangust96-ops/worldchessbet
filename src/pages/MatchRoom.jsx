import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Shield, Check, Loader2, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

export default function MatchRoom() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [match, setMatch] = useState(null);
  const [user, setUser] = useState(null);
  const [depositing, setDepositing] = useState(false);
  const [hasDeposited, setHasDeposited] = useState(false);

  useEffect(() => {
    const load = async () => {
      const me = await base44.auth.me();
      setUser(me);
      const m = await base44.entities.Match.get(id);
      setMatch(m);
      const isP1 = m.player1_id === me.id;
      setHasDeposited(isP1 ? m.player1_deposited : m.player2_deposited);
    };
    load();
  }, [id]);

  // Poll for both players deposited
  useEffect(() => {
    if (!match) return;
    const poll = setInterval(async () => {
      const m = await base44.entities.Match.get(id);
      setMatch(m);
      if (m.status === "in_progress" || (m.player1_deposited && m.player2_deposited)) {
        clearInterval(poll);
        navigate(`/active/${id}`);
      }
    }, 2000);
    return () => clearInterval(poll);
  }, [match?.id]);

  const handleDeposit = async () => {
    if (!match || !user) return;
    setDepositing(true);
    const isP1 = match.player1_id === user.id;

    // Lock funds from wallet
    const wallets = await base44.entities.Wallet.filter({ user_id: user.id });
    if (wallets.length > 0 && wallets[0].balance >= match.wager_amount) {
      await base44.entities.Wallet.update(wallets[0].id, {
        balance: wallets[0].balance - match.wager_amount,
        total_wagered: (wallets[0].total_wagered || 0) + match.wager_amount,
      });

      await base44.entities.WalletTransaction.create({
        user_id: user.id,
        type: "wager_lock",
        amount: match.wager_amount,
        match_id: match.id,
        description: `Wager locked for match`,
      });

      const updates = isP1
        ? { player1_deposited: true }
        : { player2_deposited: true };

      // Check if other player already deposited → move to in_progress
      const currentMatch = await base44.entities.Match.get(id);
      const otherDeposited = isP1
        ? currentMatch.player2_deposited
        : currentMatch.player1_deposited;
      if (otherDeposited) {
        updates.status = "in_progress";
      } else {
        updates.status = "deposited";
      }

      await base44.entities.Match.update(id, updates);
      setHasDeposited(true);
    }
    setDepositing(false);
  };

  if (!match || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-[#C9A84C]" size={28} />
      </div>
    );
  }

  const isP1 = match.player1_id === user.id;
  const opponentDeposited = isP1 ? match.player2_deposited : match.player1_deposited;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-sm w-full space-y-8 text-center"
      >
        {/* Match Amount */}
        <div className="space-y-2">
          <div className="w-16 h-16 rounded-2xl gold-gradient flex items-center justify-center mx-auto">
            <Crown size={28} className="text-black" />
          </div>
          <h1 className="text-3xl font-extrabold text-white">${match.wager_amount} Match</h1>
          <p className="text-white/40 text-sm">Both players must deposit to begin</p>
        </div>

        {/* Escrow Status */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-4">
          <div className="flex items-center gap-3 text-left">
            <Shield size={18} className="text-[#C9A84C] shrink-0" />
            <div>
              <p className="text-xs font-semibold text-white/60 uppercase tracking-wider">Escrow</p>
              <p className="text-2xl font-bold text-white">${match.wager_amount * 2}</p>
            </div>
          </div>

          <div className="space-y-3">
            {/* You */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03]">
              <span className="text-sm text-white/70">You</span>
              {hasDeposited ? (
                <span className="flex items-center gap-1.5 text-xs font-medium text-[#C9A84C]">
                  <Check size={14} /> Deposited
                </span>
              ) : (
                <span className="text-xs text-white/30">Pending</span>
              )}
            </div>
            {/* Opponent */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03]">
              <span className="text-sm text-white/70">Opponent</span>
              {opponentDeposited ? (
                <span className="flex items-center gap-1.5 text-xs font-medium text-[#C9A84C]">
                  <Check size={14} /> Deposited
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-white/30">
                  <Loader2 size={12} className="animate-spin" /> Waiting
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action */}
        {!hasDeposited && (
          <Button
            onClick={handleDeposit}
            disabled={depositing}
            className="w-full h-14 rounded-2xl text-base font-bold gold-gradient text-black hover:opacity-90 transition-opacity"
          >
            {depositing ? (
              <Loader2 className="animate-spin mr-2" size={18} />
            ) : null}
            Deposit ${match.wager_amount}
          </Button>
        )}

        {hasDeposited && !opponentDeposited && (
          <div className="flex items-center justify-center gap-2 text-white/40">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-sm">Waiting for opponent to deposit…</span>
          </div>
        )}
      </motion.div>
    </div>
  );
}