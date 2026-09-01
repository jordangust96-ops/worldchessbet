import React from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, ScanSearch, Scale } from "lucide-react";

const STEPS = [
  {
    icon: ShieldCheck,
    title: "Server-verified games",
    description: "Real players. Server-verified results."
  },
  {
    icon: ScanSearch,
    title: "Stockfish screening",
    description: "Engine checks help keep games clean."
  },
  {
    icon: Scale,
    title: "Human review + appeals",
    description: "Report a concern. A person reviews it."
  },
];

export default function HowItWorksSection() {
  return (
    <section aria-labelledby="fair-play-section-title" className="px-6 py-20">
      <div className="max-w-4xl mx-auto space-y-16">
        {/* Header */}
        <div className="text-center space-y-3">
          <h2 id="fair-play-section-title" className="text-2xl sm:text-3xl font-extrabold tracking-widest text-[#C9A84C] uppercase">
            How we keep it fair
          </h2>
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