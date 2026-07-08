import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Crown } from "lucide-react";
import { base44 } from "@/api/base44Client";
import ChessboardPreview from "@/components/play/ChessboardPreview";
import MatchDiscoveryCard from "@/components/play/MatchDiscoveryCard";
import HostMatchPanel from "@/components/play/HostMatchPanel";

export default function Home() {
  const [user, setUser] = useState(null);
  const [wallet, setWallet] = useState(null);

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

  return (
    <div className="min-h-screen px-5 pt-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-6"
      >
        <div className="flex items-center gap-2">
          <Crown size={18} className="text-[#C9A84C]" />
          <span className="text-sm font-bold tracking-tight text-white">
            Chess<span className="text-[#C9A84C]">Bet</span>
          </span>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-widest text-white/40 mb-0.5">Balance</p>
          <p className="text-lg font-bold text-[#C9A84C]">
            ${wallet?.balance?.toFixed(2) || "0.00"}
          </p>
        </div>
      </motion.div>

      {/* Main Layout */}
      <div className="flex flex-col lg:flex-row gap-6 max-w-6xl mx-auto">
        {/* Board */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:w-[65%] w-full"
        >
          <ChessboardPreview />
        </motion.div>

        {/* Match Discovery + Host */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="lg:w-[35%] w-full space-y-5"
        >
          <MatchDiscoveryCard userId={user?.id} />
          <HostMatchPanel userId={user?.id} balance={wallet?.balance || 0} />
        </motion.div>
      </div>
    </div>
  );
}