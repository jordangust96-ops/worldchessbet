import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Crown, Swords, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import WagerSelector from "@/components/match/WagerSelector";
import RecentMatches from "@/components/match/RecentMatches";

export default function Home() {
  const [user, setUser] = useState(null);
  const [wallet, setWallet] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      const me = await base44.auth.me();
      setUser(me);
      const wallets = await base44.entities.Wallet.filter({ user_id: me.id });
      if (wallets.length > 0) {
        setWallet(wallets[0]);
      } else {
        const newWallet = await base44.entities.Wallet.create({
          user_id: me.id,
          balance: 0,
          total_wagered: 0,
          total_won: 0,
          total_deposited: 0,
          total_withdrawn: 0,
        });
        setWallet(newWallet);
      }
    };
    load();
  }, []);

  const handleFindMatch = (amount) => {
    navigate(`/search?wager=${amount}`);
  };

  return (
    <div className="min-h-screen px-5 pt-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-8"
      >
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Crown size={18} className="text-[#C9A84C]" />
            <span className="text-sm font-bold tracking-tight text-white">
              Chess<span className="text-[#C9A84C]">Bet</span>
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white">
            Welcome{user ? `, ${user.full_name?.split(" ")[0] || ""}` : ""}
          </h1>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-widest text-white/40 mb-0.5">Balance</p>
          <p className="text-xl font-bold text-[#C9A84C]">
            ${wallet?.balance?.toFixed(2) || "0.00"}
          </p>
        </div>
      </motion.div>

      {/* Quick Play Card */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-3xl bg-gradient-to-br from-[#1A1A1A] to-[#111] border border-white/5 p-6 mb-6"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl gold-gradient flex items-center justify-center">
            <Swords size={20} className="text-black" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Quick Play</h2>
            <p className="text-xs text-white/40">Choose your wager to find a match</p>
          </div>
        </div>
        <WagerSelector onSelect={handleFindMatch} balance={wallet?.balance || 0} />
      </motion.div>

      {/* Recent Matches */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white/70">Recent Matches</h3>
          <ChevronRight size={16} className="text-white/30" />
        </div>
        <RecentMatches userId={user?.id} />
      </motion.div>
    </div>
  );
}