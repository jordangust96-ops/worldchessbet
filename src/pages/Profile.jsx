import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { User, Mail, Trophy, Swords, LogOut, Loader2, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

export default function Profile() {
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({ played: 0, won: 0, winRate: 0 });
  const [chessUsername, setChessUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const me = await base44.auth.me();
      setUser(me);
      setChessUsername(me.chess_com_username || "");

      // Calculate stats
      const matches = await base44.entities.Match.filter({ status: "completed" });
      const userMatches = matches.filter(
        (m) => m.player1_id === me.id || m.player2_id === me.id
      );
      const wins = userMatches.filter((m) => m.winner_id === me.id).length;
      setStats({
        played: userMatches.length,
        won: wins,
        winRate: userMatches.length > 0 ? Math.round((wins / userMatches.length) * 100) : 0,
      });
      setLoading(false);
    };
    load();
  }, []);

  const handleSaveUsername = async () => {
    setSaving(true);
    await base44.auth.updateMe({ chess_com_username: chessUsername });
    setSaving(false);
  };

  const handleLogout = () => {
    base44.auth.logout("/landing");
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
        {/* Profile Header */}
        <div className="text-center space-y-3">
          <div className="w-20 h-20 rounded-full gold-gradient flex items-center justify-center mx-auto">
            <span className="text-2xl font-extrabold text-black">
              {user?.full_name?.[0]?.toUpperCase() || "?"}
            </span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{chessUsername || user?.full_name || "Player"}</h1>
            <p className="text-sm text-white/40">{user?.email}</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: Swords, label: "Played", value: stats.played },
            { icon: Trophy, label: "Won", value: stats.won },
            { icon: Crown, label: "Win Rate", value: `${stats.winRate}%` },
          ].map(({ icon: Icon, label, value }) => (
            <div
              key={label}
              className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 text-center"
            >
              <Icon size={18} className="text-[#C9A84C] mx-auto mb-2" />
              <p className="text-lg font-bold text-white">{value}</p>
              <p className="text-[10px] text-white/40 uppercase tracking-wider">{label}</p>
            </div>
          ))}
        </div>

        {/* Chess.com Username */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-3">
          <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">
            Public ChessBet Username
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={chessUsername}
              onChange={(e) => setChessUsername(e.target.value)}
              placeholder="your_username"
              className="flex-1 h-11 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/20 text-sm focus:border-[#C9A84C]/50 focus:outline-none"
            />
            <Button
              onClick={handleSaveUsername}
              disabled={saving}
              className="h-11 rounded-xl gold-gradient text-black font-bold hover:opacity-90 px-5"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>

        {/* Account Info */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <User size={16} className="text-white/30" />
            <div>
              <p className="text-[10px] text-white/30 uppercase">Name</p>
              <p className="text-sm text-white">{user?.full_name || "—"}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Mail size={16} className="text-white/30" />
            <div>
              <p className="text-[10px] text-white/30 uppercase">Email</p>
              <p className="text-sm text-white">{user?.email || "—"}</p>
            </div>
          </div>
        </div>

        {/* Logout */}
        <Button
          onClick={handleLogout}
          variant="ghost"
          className="w-full h-12 rounded-2xl text-red-400/70 hover:text-red-400 hover:bg-red-500/5 font-medium"
        >
          <LogOut size={16} className="mr-2" />
          Sign Out
        </Button>
      </motion.div>
    </div>
  );
}