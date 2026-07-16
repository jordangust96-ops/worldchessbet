import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { User, Loader2, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { getJurisdictionMessage } from "@/lib/jurisdictionConfig";

// How often the marketplace silently checks for newly available public
// matches while the player has no active match. Purely additive to
// matchmaking/subscriptions — does not touch acceptance or realtime gameplay.
const AUTO_REFRESH_INTERVAL_MS = 7000;

export default function AvailableMatchSection({ userId, balance, activeMatch, onChallengeCancelled, onAccepted }) {
  const { jurisdictionStatus, jurisdictionReason } = useAuth();
  const jurisdictionBlocked = !!jurisdictionStatus && jurisdictionStatus !== "approved";
  const [opponents, setOpponents] = useState([]);
  const [declinedIds, setDeclinedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState("");

  const fetchMatches = useCallback(async () => {
    if (!userId) return;
    const res = await base44.functions.invoke("getAvailableMatches", {});
    setOpponents(res.data.matches || []);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      await fetchMatches();
      setLoading(false);
    })();
  }, [userId, fetchMatches]);

  // Automatic background refresh so newly hosted matches surface without
  // requiring a page reload.
  useEffect(() => {
    if (!userId) return;
    const interval = setInterval(fetchMatches, AUTO_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [userId, fetchMatches]);

  // Hosting a match ends the current browsing session — start fresh next time.
  useEffect(() => {
    if (activeMatch) setDeclinedIds([]);
  }, [activeMatch]);

  const visibleOpponents = opponents.filter((o) => !declinedIds.includes(o.id));
  const current = visibleOpponents[0];
  const insufficientFunds = current ? (balance || 0) < current.wager_amount : false;

  const handleFindMatch = async () => {
    setSearching(true);
    await fetchMatches();
    setSearching(false);
  };

  const handleFindNewMatches = async () => {
    setSearching(true);
    setDeclinedIds([]);
    await fetchMatches();
    setSearching(false);
  };

  const handleDecline = () => {
    if (!current) return;
    setDeclinedIds((ids) => [...ids, current.id]);
  };

  const handleAccept = async () => {
    if (!current) return;
    setAccepting(true);
    setAcceptError("");
    if (activeMatch) {
      await base44.functions.invoke("cancelMatch", { matchId: activeMatch.id });
      onChallengeCancelled?.();
    }
    // Immediately reserves the opponent slot and moves both players into the
    // shared Preparing Match screen — Fair Play certification and the Entry
    // Amount reservation both happen there, not here.
    const { data } = await base44.functions.invoke("acceptMatch", { matchId: current.id });
    setAccepting(false);
    if (data?.error) {
      setAcceptError(data.error);
      return;
    }
    setDeclinedIds([]);
    onAccepted?.(current.id);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 lg:h-24">
        <Loader2 className="animate-spin text-[#C9A84C]" size={22} />
      </div>
    );
  }

  if (opponents.length === 0) {
    return (
      <div>
        <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2 lg:mb-1.5">Available Match</p>
        <div className="text-center py-6 lg:py-3 px-2 space-y-2 lg:space-y-1">
          <p className="text-white font-bold text-base lg:text-sm">No Matches Available</p>
          <p className="text-white/40 text-sm lg:text-xs leading-relaxed max-w-xs mx-auto">
            No one is waiting to play right now. Create your own challenge below and we'll automatically
            present it to other players.
          </p>
          <Button
            onClick={handleFindMatch}
            disabled={searching}
            variant="outline"
            className="h-11 lg:h-9 px-6 rounded-2xl border-white/10 text-white/60 font-semibold hover:bg-white/5 disabled:opacity-60"
          >
            {searching ? (
              <>
                <Loader2 className="animate-spin mr-2" size={16} /> Searching...
              </>
            ) : (
              "Refresh Available Matches"
            )}
          </Button>
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div>
        <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2 lg:mb-1.5">Available Match</p>
        <div className="text-center py-6 lg:py-3 px-2 space-y-2 lg:space-y-1">
          <SearchX size={22} className="text-white/20 mx-auto" />
          <p className="text-white font-bold text-base lg:text-sm">No More Matches</p>
          <p className="text-white/40 text-sm lg:text-xs leading-relaxed max-w-xs mx-auto">
            You've reviewed all currently available public matches. New matches may appear at any time.
          </p>
          <Button
            onClick={handleFindNewMatches}
            disabled={searching}
            variant="outline"
            className="h-11 lg:h-9 px-6 rounded-2xl border-white/10 text-white/60 font-semibold hover:bg-white/5 disabled:opacity-60"
          >
            {searching ? (
              <>
                <Loader2 className="animate-spin mr-2" size={16} /> Searching...
              </>
            ) : (
              "Refresh Your Matches"
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-white/30 mb-4 lg:mb-1.5">Available Match</p>
      <AnimatePresence mode="wait">
        <motion.div
          key={current.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="space-y-6 lg:space-y-2"
        >
          <div className="flex items-center gap-3 lg:gap-2">
            <div className="w-11 h-11 lg:w-8 lg:h-8 rounded-xl bg-white/[0.06] flex items-center justify-center shrink-0">
              <User size={18} className="text-white/50 lg:w-4 lg:h-4" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/30">Opponent</p>
              <p className="text-lg lg:text-sm font-bold text-white">{current.opponentName}</p>
              <p className="text-xs text-white/30">
                {current.gamesPlayed > 0
                  ? `${current.gamesPlayed} Games • ${current.winPercentage}% Win Rate`
                  : "New Player"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:gap-2">
            <div className="rounded-2xl bg-[#C9A84C]/5 border border-[#C9A84C]/20 p-4 lg:p-2">
              <p className="text-[10px] uppercase tracking-widest text-[#C9A84C]/60 mb-1">Entry Amount</p>
              <p className="text-xl lg:text-base font-bold text-[#C9A84C]">${current.wager_amount.toFixed(2)}</p>
            </div>
            <div className="rounded-2xl bg-white/[0.03] p-4 lg:p-2">
              <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Time Control</p>
              <p className="text-base lg:text-sm font-bold text-white">{current.display_name || "Rapid"}</p>
            </div>
          </div>

          {jurisdictionBlocked && (
            <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-3">
              <p className="text-xs text-red-400/80 leading-snug whitespace-pre-line">
                {jurisdictionReason || getJurisdictionMessage(jurisdictionStatus)}
              </p>
            </div>
          )}
          <div className="space-y-2.5 lg:space-y-1.5">
            <Button
              onClick={handleAccept}
              disabled={accepting || insufficientFunds || jurisdictionBlocked}
              className="w-full h-14 lg:h-10 rounded-2xl text-base lg:text-sm font-bold gold-gradient text-black hover:opacity-90 transition-opacity disabled:opacity-30"
            >
              {accepting ? <Loader2 className="animate-spin mr-2" size={18} /> : null}
              Join Challenge
            </Button>
            {insufficientFunds && (
              <p className="text-[11px] text-center text-[#C9A84C]/70">
                {(balance || 0) <= 0 ? "Fund your wallet to join challenges." : "Insufficient balance for this entry amount."}{" "}
                <Link to="/wallet" className="underline font-semibold hover:text-[#C9A84C]">
                  Add Funds
                </Link>
              </p>
            )}
            {acceptError && <p className="text-[11px] text-center text-red-400">{acceptError}</p>}
            <Button
              onClick={handleDecline}
              variant="outline"
              disabled={accepting}
              className="w-full h-12 lg:h-8 rounded-2xl border-white/10 text-white/60 font-semibold hover:bg-white/5"
            >
              Decline Match
            </Button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}