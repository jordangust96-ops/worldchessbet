import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

export default function SearchMatch() {
  const [searchParams] = useSearchParams();
  const wager = Number(searchParams.get("wager")) || 5;
  const navigate = useNavigate();
  const [seconds, setSeconds] = useState(0);
  const [matchId, setMatchId] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, []);

  // Create a match entry with "searching" status
  useEffect(() => {
    const createSearch = async () => {
      const me = await base44.auth.me();
      // Check for existing searching matches at this wager from other users
      const existing = await base44.entities.Match.filter({
        status: "searching",
        wager_amount: wager,
      });
      const available = existing.find((m) => m.player1_id !== me.id);
      if (available) {
        // Join existing match
        await base44.entities.Match.update(available.id, {
          player2_id: me.id,
          status: "matched",
        });
        navigate(`/match/${available.id}`);
      } else {
        // Create new search
        const match = await base44.entities.Match.create({
          player1_id: me.id,
          wager_amount: wager,
          status: "searching",
        });
        setMatchId(match.id);
      }
    };
    createSearch();
  }, [wager]);

  // Poll for match
  useEffect(() => {
    if (!matchId) return;
    const poll = setInterval(async () => {
      const match = await base44.entities.Match.get(matchId);
      if (match.status === "matched") {
        clearInterval(poll);
        navigate(`/match/${matchId}`);
      }
    }, 2000);
    return () => clearInterval(poll);
  }, [matchId]);

  const handleCancel = async () => {
    if (matchId) {
      await base44.entities.Match.update(matchId, { status: "cancelled" });
    }
    navigate("/");
  };

  const formatTime = (s) => {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center space-y-8 max-w-sm w-full"
      >
        {/* Pulsing ring animation */}
        <div className="relative w-32 h-32 mx-auto">
          <motion.div
            className="absolute inset-0 rounded-full border-2 border-[#C9A84C]/30"
            animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0, 0.3] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute inset-2 rounded-full border-2 border-[#C9A84C]/20"
            animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0, 0.2] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
          />
          <div className="absolute inset-4 rounded-full gold-gradient flex items-center justify-center">
            <span className="text-black font-extrabold text-2xl">${wager}</span>
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-bold text-white">Finding Opponent</h2>
          <p className="text-white/40 text-sm">
            Matching you with a ${wager} player…
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 text-white/30">
          <Loader2 size={14} className="animate-spin" />
          <span className="text-sm font-mono">{formatTime(seconds)}</span>
        </div>

        <Button
          variant="ghost"
          onClick={handleCancel}
          className="text-white/40 hover:text-white/70"
        >
          <X size={16} className="mr-2" />
          Cancel Search
        </Button>
      </motion.div>
    </div>
  );
}