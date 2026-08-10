import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { UserPlus, Swords, Trophy, ShieldCheck } from "lucide-react";

const STEPS = [
  {
    icon: UserPlus,
    title: "Create Your Account",
    description: "Sign up in seconds and step into a community built for serious chess players.",
  },
  {
    icon: Swords,
    title: "Host or Accept a Challenge",
    description: "Set your contest amount and time control, or accept an open challenge from another player.",
  },
  {
    icon: Trophy,
    title: "Compete Head-to-Head",
    description: "Play a real, server-verified chess match. The result is decided by skill — nothing else.",
  },
  {
    icon: ShieldCheck,
    title: "Get Paid Instantly",
    description: "When the match ends decisively, winnings are settled automatically and securely.",
  },
];

export default function HowItWorksSection() {
  // whileInView alone isn't enough here — if the section already intersects
  // the viewport at initial mount (e.g. shorter hero, taller screen), it
  // fires immediately with no scroll. Gate visibility on an actual scroll
  // event so the section stays fully hidden pre-scroll no matter the layout.
  const [hasScrolled, setHasScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      if (window.scrollY > 0) {
        setHasScrolled(true);
        window.removeEventListener("scroll", onScroll);
      }
    };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: hasScrolled ? 1 : 0 }}
      transition={{ duration: 0.4 }}
      className="px-6 py-20"
    >
      <div className="max-w-4xl mx-auto space-y-16">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6 }}
          className="text-center space-y-3"
        >
          <p className="text-2xl sm:text-3xl font-extrabold tracking-widest text-[#C9A84C] uppercase">
            How It Works
          </p>
        </motion.div>

        {/* Steps */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STEPS.map(({ icon: Icon, title, description }, idx) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: idx * 0.1, duration: 0.5 }}
              className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-3"
            >
              <div className="w-10 h-10 rounded-xl gold-gradient flex items-center justify-center">
                <Icon size={18} className="text-black" />
              </div>
              <h3 className="text-sm font-bold text-white">{title}</h3>
              <p className="text-xs text-white/50 leading-relaxed">{description}</p>
            </motion.div>
          ))}
        </div>

        {/* Fair Play Callout */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6 }}
          className="rounded-3xl bg-gradient-to-br from-[#151310] to-[#0F0F0F] border border-[#C9A84C]/20 p-8 space-y-6"
        >
          <div className="text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-[#C9A84C]/10 flex items-center justify-center mx-auto">
              <ShieldCheck size={22} className="text-[#C9A84C]" />
            </div>
            <h3 className="text-xl font-bold text-white">Fair Play Is Non-Negotiable</h3>
            <p className="text-white/50 text-sm max-w-2xl mx-auto leading-relaxed">
              ChessBet combines server-authoritative gameplay, automated post-game screening,
              behavioral integrity signals, player reporting, and confidential human review to
              protect every contest.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
            {[
              {
                title: "Server-Authoritative Play",
                description: "Legal moves, game state, results, and chess clocks are validated and recorded by ChessBet's servers.",
              },
              {
                title: "Stockfish Post-Game Screening",
                description: "Completed contests are queued for engine analysis using move agreement, centipawn-loss, critical-position, and timing signals.",
              },
              {
                title: "Behavioral Integrity Signals",
                description: "Focus-loss events and unusual opponent, resignation, or timeout patterns can trigger closer review.",
              },
              {
                title: "Confidential Human Review",
                description: "Automated indicators, player reports, and dispute evidence are organized for admin review before any enforcement decision.",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4">
                <p className="text-sm font-semibold text-white">{item.title}</p>
                <p className="mt-1.5 text-xs leading-5 text-white/45">{item.description}</p>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-white/35">
            Automated screening identifies signals for review; it does not make an automatic finding of misconduct.
          </p>
          <div className="text-center">
            <Link
              to="/fair-play-integrity"
              className="inline-block text-sm font-semibold text-[#C9A84C] hover:underline underline-offset-2"
            >
              Read our Fair Play & Integrity Policy
            </Link>
          </div>
        </motion.div>
      </div>
    </motion.section>
  );
}