import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ShieldCheck, ScanSearch, Scale } from "lucide-react";

const STEPS = [
  {
    icon: ShieldCheck,
    title: "Server-verified games",
    description: "Your moves, clock, and result are recorded by the server — no bots, real players.",
  },
  {
    icon: ScanSearch,
    title: "Stockfish screening",
    description: "Completed games are screened for engine-detection signals that need a closer look.",
  },
  {
    icon: Scale,
    title: "Human review + appeals",
    description: "If you think you were cheated, report it. People review the evidence and appeals path.",
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
            How we keep it fair
          </p>
        </motion.div>

        {/* Steps */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
            <h3 className="text-xl font-bold text-white">Engine detection with a human appeals path</h3>
            <p className="text-white/50 text-sm max-w-2xl mx-auto leading-relaxed">
              We screen for evidence, not automatic verdicts. People review fair-play concerns and appeals.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-3 text-sm text-white/60">
            {["Server-verified play", "Post-game screening", "Player reports", "Human review"].map((item) => (
              <span key={item} className="rounded-full border border-white/[0.08] bg-white/[0.025] px-4 py-2">
                {item}
              </span>
            ))}
          </div>

          <p className="text-center text-xs text-white/35">
            Automated screening flags signals for review. People make the calls.
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