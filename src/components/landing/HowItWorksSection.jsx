import React from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, ScanSearch, Scale } from "lucide-react";

const STEPS = [
  {
    icon: ShieldCheck,
    title: "Server-verified play",
    description: "Moves, clocks, and results are recorded by ChessBet."
  },
  {
    icon: ScanSearch,
    title: "Integrity screening",
    description: "Stockfish analysis helps surface unusual patterns after play."
  },
  {
    icon: Scale,
    title: "Human review + appeals",
    description: "Report a concern. A person reviews the full context."
  },
];

export default function HowItWorksSection() {
  return (
    <section aria-labelledby="trust-section-title" className="px-6 py-20">
      <div className="max-w-4xl mx-auto space-y-10">
        {/* Header */}
        <div className="text-center space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C9A84C]">
            Fair play, built in
          </p>
          <h2 id="trust-section-title" className="text-2xl sm:text-3xl font-extrabold text-white">
            Skill decides the game. ChessBet protects the contest.
          </h2>
          <p className="mx-auto max-w-2xl text-sm leading-relaxed text-white/55">
            ChessBet records play on its servers, supports post-game screening when data and services are available, and provides reporting and human review for concerns.
          </p>
        </div>

        {/* Steps */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {STEPS.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-3"
            >
              <div className="w-10 h-10 rounded-xl gold-gradient flex items-center justify-center">
                <Icon size={18} className="text-black" />
              </div>
              <h3 className="text-sm font-bold text-white">{title}</h3>
              <p className="text-xs text-white/50 leading-relaxed">{description}</p>
            </div>
          ))}
        </div>

        {/* Fair Play Callout */}
        <div className="rounded-3xl bg-gradient-to-br from-[#151310] to-[#0F0F0F] border border-[#C9A84C]/20 p-8 space-y-6">
          <div className="text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-[#C9A84C]/10 flex items-center justify-center mx-auto">
              <ShieldCheck size={22} className="text-[#C9A84C]" />
            </div>
            <h3 className="text-xl font-bold text-white">We look closer before we act</h3>
            <p className="text-white/50 text-sm max-w-2xl mx-auto leading-relaxed">
              Stockfish can surface unusual patterns; reviewers consider the game record and player reports.
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
            Players can report concerns and appeal enforcement decisions.
          </p>
          <div className="text-center">
            <Link
              to="/fair-play-integrity#fair-play-and-appeals"
              className="inline-block text-sm font-semibold text-[#C9A84C] hover:underline underline-offset-2"
            >
              Read our Fair Play & Integrity Policy
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}