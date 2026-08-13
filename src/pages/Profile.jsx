import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Trophy, Swords, LogOut, Loader2, Crown, XCircle, Flag, ChevronRight, HelpCircle, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import Logo from "@/components/Logo";
import DemoModeNotice from "@/components/DemoModeNotice";
import LegalSection from "@/components/profile/LegalSection";
import DeleteAccountButton from "@/components/profile/DeleteAccountButton";
import AdminToolsSection from "@/components/profile/AdminToolsSection";
import FoundingPlayerBadge from "@/components/profile/FoundingPlayerBadge";
import SoundToggle from "@/components/play/SoundToggle";
import { clearMfaVerified } from "@/lib/mfaSession";
import { getStoredSoundPreference, playGameSound, storeSoundPreference } from "@/lib/gameSounds";

export default function Profile() {
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({ played: 0, won: 0, lost: 0, winRate: 0 });
  const [chessUsername, setChessUsername] = useState("");
  const [savedUsername, setSavedUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [usernameMessage, setUsernameMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(getStoredSoundPreference);
  const [savingSound, setSavingSound] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const me = await base44.auth.me();
        const username = me.chess_com_username || "";
        setUser(me);
        setChessUsername(username);
        setSavedUsername(username);
        const soundsOn = me.sound_enabled == null ? getStoredSoundPreference() : me.sound_enabled !== false;
        setSoundEnabled(soundsOn);
        storeSoundPreference(soundsOn);

        // Settlement maintains these canonical per-player counters. Reading the
        // current user avoids loading every completed platform match just to
        // calculate one profile card.
        setStats({
          played: me.games_played || 0,
          won: me.games_won || 0,
          lost: me.games_lost || 0,
          winRate: me.win_percentage || 0,
        });
      } catch {
        setLoadError("We couldn't load your profile. Please try again.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const normalizedUsername = chessUsername.trim();
  const usernameChanged = normalizedUsername !== savedUsername;

  const handleSaveUsername = async () => {
    if (!normalizedUsername || !usernameChanged) return;
    setSaving(true);
    setUsernameMessage("");
    try {
      await base44.auth.updateMe({ chess_com_username: normalizedUsername });
      setChessUsername(normalizedUsername);
      setSavedUsername(normalizedUsername);
      setUser((current) => current ? { ...current, chess_com_username: normalizedUsername } : current);
      setUsernameMessage("Username updated.");
    } catch {
      setUsernameMessage("Unable to update your username. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleSoundChange = async (enabled) => {
    const previous = soundEnabled;
    setSoundEnabled(enabled);
    storeSoundPreference(enabled);
    if (enabled) playGameSound("enabled", true);
    setSavingSound(true);
    try {
      await base44.auth.updateMe({ sound_enabled: enabled });
      setUser((current) => current ? { ...current, sound_enabled: enabled } : current);
    } catch {
      setSoundEnabled(previous);
      storeSoundPreference(previous);
    } finally {
      setSavingSound(false);
    }
  };

  const handleLogout = () => {
    clearMfaVerified();
    base44.auth.logout("/landing");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-[#C9A84C]" size={28} />
      </div>);

  }

  if (loadError) {
    return (
      <div className="min-h-screen px-5 pt-8">
        <Link to="/play" className="inline-block">
          <Logo size="sm" />
        </Link>
        <div className="mt-8 rounded-2xl bg-white/[0.03] border border-white/5 p-6 text-center">
          <p className="text-sm text-white/60">{loadError}</p>
          <Button
            onClick={() => window.location.reload()}
            className="mt-4 h-10 rounded-xl gold-gradient text-black font-bold hover:opacity-90"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-5 pt-8">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-6">

        <Link to="/play" className="inline-block">
          <Logo size="sm" />
        </Link>
        <DemoModeNotice />

        {/* Profile Header */}
        <div className="text-center space-y-3">
          <div className="w-20 h-20 rounded-full gold-gradient flex items-center justify-center mx-auto">
            <span className="text-2xl font-extrabold text-black">
              {user?.full_name?.[0]?.toUpperCase() || "?"}
            </span>
          </div>
          <div>
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-xl font-bold text-white">{chessUsername || user?.full_name || "Player"}</h1>
              {user?.founding_player && <FoundingPlayerBadge />}
              {user?.role === "admin" && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#C9A84C]/15 border border-[#C9A84C]/30 text-[10px] font-bold text-[#C9A84C] uppercase tracking-wider">
                  Admin
                </span>
              )}
            </div>
            <p className="text-sm text-white/40">{user?.email}</p>

          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
          { icon: Swords, label: "Played", value: stats.played },
          { icon: Trophy, label: "Won", value: stats.won },
          { icon: XCircle, label: "Lost", value: stats.lost },
          { icon: Crown, label: "Win Rate", value: `${stats.winRate}%` }].
          map(({ icon: Icon, label, value }) =>
          <div
            key={label}
            className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 text-center">
            
              <Icon size={18} className="text-[#C9A84C] mx-auto mb-2" />
              <p className="text-lg font-bold text-white">{value}</p>
              <p className="text-[10px] text-white/40 uppercase tracking-wider">{label}</p>
            </div>
          )}
        </div>

        {/* Account Info */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-5">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">
                Public ChessBet Username
              </label>
              <span className="text-[10px] text-white/30">{chessUsername.length}/16</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={chessUsername}
                onChange={(e) => {
                  setChessUsername(e.target.value.slice(0, 16));
                  setUsernameMessage("");
                }}
                maxLength={16}
                aria-label="Public ChessBet username"
                placeholder="your_username"
                className="flex-1 h-11 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder:text-white/20 text-sm focus:border-[#C9A84C]/50 focus:outline-none" />
              
              <Button
                onClick={handleSaveUsername}
                disabled={saving || !normalizedUsername || !usernameChanged}
                className="h-11 rounded-xl gold-gradient text-black font-bold hover:opacity-90 px-5 disabled:opacity-30">
                
                {saving ? <Loader2 size={14} className="animate-spin" /> : "Save"}
              </Button>
            </div>
            {usernameMessage && (
              <p
                role="status"
                className={`text-[11px] ${usernameMessage === "Username updated." ? "text-[#C9A84C]/80" : "text-red-400"}`}
              >
                {usernameMessage}
              </p>
            )}
          </div>
        </div>

        {/* Sound Preferences */}
        <div className="space-y-2">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-white/35">Preferences</p>
          <SoundToggle enabled={soundEnabled} onChange={handleSoundChange} disabled={savingSound} />
        </div>

        {/* Help & activity */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-1">
          <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">Help & Activity</p>
          {[
            { to: "/my-reports", icon: Flag, label: "My Reports" },
            { to: "/faq", icon: HelpCircle, label: "FAQ" },
            { to: "/blog", icon: BookOpen, label: "Blog" },
          ].map(({ to, icon: Icon, label }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center justify-between py-3 -mx-1 px-1 hover:bg-white/[0.03] rounded-xl transition-colors"
            >
              <div className="flex items-center gap-3">
                <Icon size={16} className="text-white/40" />
                <span className="text-sm text-white">{label}</span>
              </div>
              <ChevronRight size={16} className="text-white/20" />
            </Link>
          ))}
        </div>

        {/* Admin Tools */}
        {user?.role === "admin" && <AdminToolsSection userEmail={user?.email} />}

        {/* Legal */}
        <LegalSection />

        {/* Logout */}
        <Button
          onClick={handleLogout}
          variant="ghost"
          className="w-full h-12 rounded-2xl text-red-400/70 hover:text-red-400 hover:bg-red-500/5 font-medium">
          
          <LogOut size={16} className="mr-2" />
          Sign Out
        </Button>

        <DeleteAccountButton onClosed={handleLogout} />
      </motion.div>
    </div>);

}