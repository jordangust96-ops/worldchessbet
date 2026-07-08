import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Crown, Zap, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <Crown className="text-[#C9A84C]" size={24} />
          <span className="text-lg font-bold tracking-tight text-white">
            Chess<span className="text-[#C9A84C]">Bet</span>
          </span>
        </div>
        <Link to="/login">
          <Button variant="ghost" className="text-white/70 hover:text-white text-sm">
            Sign In
          </Button>
        </Link>
      </header>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="space-y-8 max-w-md"
        >
          <div className="space-y-4">
            <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight text-white leading-[1.1]">
              Wager on
              <br />
              <span className="gold-text">Your Moves</span>
            </h1>
            <p className="text-white/50 text-lg leading-relaxed max-w-sm mx-auto">
              The fastest way to put money on a chess match. Pick a stake, find an opponent, play, and win.
            </p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            <Link to="/register">
              <Button
                size="lg"
                className="w-full gold-gradient text-black font-bold text-lg h-14 rounded-2xl hover:opacity-90 transition-opacity"
              >
                Get Started
              </Button>
            </Link>
            <p className="text-white/30 text-xs mt-4">
              Already have an account?{" "}
              <Link to="/login" className="text-[#C9A84C] hover:underline">
                Sign in
              </Link>
            </p>
          </motion.div>
        </motion.div>

        {/* Features */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          className="grid grid-cols-3 gap-4 mt-16 max-w-sm w-full"
        >
          {[
            { icon: Zap, label: "Instant\nMatching" },
            { icon: Shield, label: "Secure\nEscrow" },
            { icon: Crown, label: "Auto\nPayout" },
          ].map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/[0.03] border border-white/5"
            >
              <Icon size={20} className="text-[#C9A84C]" />
              <span className="text-[11px] text-white/50 font-medium text-center whitespace-pre-line leading-tight">
                {label}
              </span>
            </div>
          ))}
        </motion.div>
      </div>

      {/* Footer */}
      <footer className="px-6 py-6 text-center">
        <p className="text-white/20 text-xs">
          © 2026 ChessBet. All rights reserved.
        </p>
      </footer>
    </div>
  );
}