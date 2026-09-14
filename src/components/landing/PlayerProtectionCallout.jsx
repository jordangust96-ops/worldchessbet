import React from "react";
import { WalletCards, Timer, Trophy } from "lucide-react";

const ITEMS = [
  {
    icon: WalletCards,
    title: "Choose your challenge",
    description: "Select an entry amount that matches your confidence.",
  },
  {
    icon: Timer,
    title: "Own the clock",
    description: "Blitz, Rapid, or Classical—choose how fast the pressure builds.",
  },
  {
    icon: Trophy,
    title: "Win the whole prize",
    description: "After a decisive result is confirmed, the winner earns 100% of the combined entry amounts.",
  },
];

export default function PlayerProtectionCallout() {
  return (
    <section aria-labelledby="possibilities-title" className="relative z-10 mx-auto w-full max-w-5xl px-6 py-14">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C9A84C]">Chess for real money</p>
        <h2 id="possibilities-title" className="mt-2 text-2xl font-bold text-white">
          Chess gets more interesting when something’s on the line.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/55">
          One-on-one. Real USD. Every move matters more.
        </p>
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
