import React from "react";
import { WalletCards, Timer, Trophy } from "lucide-react";

const ITEMS = [
  {
    icon: WalletCards,
    title: "Choose your stakes",
    description: "Pick an Entry Amount and put more meaning behind every move.",
  },
  {
    icon: Timer,
    title: "Play at your pace",
    description: "Blitz, Rapid, or Classical — choose the time control that fits your game.",
  },
  {
    icon: Trophy,
    title: "Play to win",
    description: "Win a decisive contest and earn 100% of the combined Contest Entry Amounts.",
  },
];

export default function PlayerProtectionCallout() {
  return (
    <section aria-labelledby="possibilities-title" className="relative z-10 mx-auto w-full max-w-5xl px-6 py-14">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C9A84C]">Chess for real stakes</p>
        <h2 id="possibilities-title" className="mt-2 text-2xl font-bold text-white">
          Chess gets more interesting when something’s on the line.
        </h2>
      </div>

      <div className="mt-7 grid gap-4 md:grid-cols-3">
        {ITEMS.map(({ icon: Icon, title, description }) => (
          <article key={title} className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
            <Icon className="text-[#C9A84C]" size={20} aria-hidden="true" />
            <h3 className="mt-4 font-semibold text-white">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/55">{description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
