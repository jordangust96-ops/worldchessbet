import React from "react";
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
  return (
    <motion.section
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, margin: "-100px" }}
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
          <p className="text-xs font-semibold tracking-widest text-[#C9A84C] uppercase">
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
          className="rounded-3xl bg-gradient-to-br from-[#151310] to-[#0F0F0F] border border-[#C9A84C]/20 p-8 text-center space-y-4"
        >
          <div className="w-12 h-12 rounded-2xl bg-[#C9A84C]/10 flex items-center justify-center mx-auto">
            <ShieldCheck size={22} className="text-[#C9A84C]" />
          </div>
          <h3 className="text-xl font-bold text-white">Fair Play Is Non-Negotiable</h3>
          <p className="text-white/50 text-sm max-w-xl mx-auto leading-relaxed">
            Every match runs on a server-verified engine, with integrity monitoring and review
            processes built in from the ground up. ChessBet exists because players trust that
            every game is decided by skill alone — so we protect that trust at every step, from
            move validation to dispute resolution.
          </p>
          <Link
            to="/fair-play-integrity"
            className="inline-block text-sm font-semibold text-[#C9A84C] hover:underline underline-offset-2"
          >
            Read our Fair Play & Integrity Policy
          </Link>
        </motion.div>
      </div>
    </motion.section>
  );
}