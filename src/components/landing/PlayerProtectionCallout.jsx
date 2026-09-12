import React from "react";
import { Link } from "react-router-dom";
import { WalletCards, Timer, Trophy } from "lucide-react";

const ITEMS = [
  {
    icon: WalletCards,
    title: "Choose your stakes",
    description: "Pick an Entry Amount and put more meaning behind every move.",
    link: "/register",
    linkLabel: "Create account",
  },
  {
    icon: Timer,
    title: "Play at your pace",
    description: "Blitz, Rapid, or Classical — choose the time control that fits your game.",
    link: "/about",
    linkLabel: "Explore ChessBet",
  },
  {
    icon: Trophy,
    title: "Play to win",
    description: "Win a decisive contest and earn 100% of the combined Contest Entry Amounts.",
    link: "/faq#how-payouts-work",
    linkLabel: "How payouts work",
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
        {ITEMS.map(({ icon: Icon, title, description, link, linkLabel }) => (
          <article key={title} className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
            <Icon className="text-[#C9A84C]" size={20} aria-hidden="true" />
            <h3 className="mt-4 font-semibold text-white">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/55">{description}</p>
            <Link to={link} className="mt-4 inline-flex text-xs font-semibold text-[#C9A84C] hover:underline underline-offset-4">
              {linkLabel}
            </Link>
          </article>
        ))}
      </div>

      <p className="mt-5 text-center text-xs text-white/35">
        Create a challenge or join one already waiting. Your next game can have more on the line.
      </p>
    </section>
  );
}
