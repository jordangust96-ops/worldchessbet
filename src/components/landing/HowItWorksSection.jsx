import React from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Swords, Lock, Trophy, ShieldCheck } from "lucide-react";
import { Image } from "@/components/ui/image";

const STEPS = [
  {
    icon: Swords,
    title: "Host or Accept a Challenge",
    description: "Set your wager and time control, or browse live challenges from real opponents ready to play.",
  },
  {
    icon: Lock,
    title: "Funds Secured in Escrow",
    description: "Both players' contest funds are held securely before a single move is made — no risk, no surprises.",
  },
  {
    icon: Trophy,
    title: "Play & Get Paid",
    description: "Compete your best chess. Winnings settle automatically the instant the match concludes.",
  },
];

const MOCKUP_URL = "https://media.base44.com/images/public/6a4ed72536c51cb3280d2bc6/b566951d1_generated_image.png";

export default function HowItWorksSection() {
  return (
    <section className="px-6 py-20 border-t border-white/5">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-2xl mx-auto mb-12"
        >
          <p className="text-[#C9A84C] text-xs font-semibold tracking-[0.2em] uppercase mb-3">
            How It Works
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Skill-Based Chess. Real Stakes.
          </h2>
          <p className="text-white/50 text-base leading-relaxed">
            ChessBet pairs you with real opponents in an escrow-backed environment. Every contest is
            funded before the first move, and every result settles the moment the game ends.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.7 }}
          className="hidden sm:block rounded-2xl border border-white/10 shadow-2xl shadow-black/60 overflow-hidden mb-14"
        >
          <Image
            src={MOCKUP_URL}
            alt="ChessBet match interface showing a live chessboard and challenge cards"
            className="w-full aspect-video"
          />
        </motion.div>

        <div className="grid sm:grid-cols-3 gap-5">
          {STEPS.map(({ icon: Icon, title, description }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="p-6 rounded-2xl bg-white/[0.03] border border-white/5"
            >
              <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center mb-4">
                <Icon size={18} className="text-[#C9A84C]" />
              </div>
              <h3 className="text-white font-semibold text-base mb-2">{title}</h3>
              <p className="text-white/45 text-sm leading-relaxed">{description}</p>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="flex items-start gap-3 mt-8 p-5 rounded-2xl bg-white/[0.02] border border-white/5"
        >
          <ShieldCheck size={18} className="text-[#C9A84C] shrink-0 mt-0.5" />
          <p className="text-white/45 text-sm leading-relaxed">
            <span className="text-white/70 font-medium">Fair Play, guaranteed.</span> Every contest is
            monitored by our integrity systems to detect and act on cheating, and any player can report
            suspicious activity for review.{" "}
            <Link to="/fair-play-integrity" className="text-[#C9A84C] hover:underline underline-offset-2">
              Learn more
            </Link>
          </p>
        </motion.div>
      </div>
    </section>
  );
}