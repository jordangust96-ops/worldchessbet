import React from "react";
import { Link } from "react-router-dom";
import { MapPin, WalletCards, ShieldCheck } from "lucide-react";

const ITEMS = [
  {
    icon: MapPin,
    title: "Where you can play",
    description: "Cash-prize play will require age, identity, and location eligibility.",
    link: "/official-rules#eligibility",
    linkLabel: "Official Rules",
  },
  {
    icon: WalletCards,
    title: "How you get paid",
    description: "Decisive results settle under clear rules. Reports and disputes have a documented review path.",
    link: "/faq#how-payouts-work",
    linkLabel: "Payout FAQ",
  },
  {
    icon: ShieldCheck,
    title: "How cheating is caught",
    description: "Server-verified games and Stockfish screening flag evidence for human review.",
    link: "/fair-play-integrity#how-cheating-is-caught",
    linkLabel: "Fair Play",
  },
];

export default function PlayerProtectionCallout() {
  return (
    <section aria-labelledby="player-protection-title" className="relative z-10 mx-auto w-full max-w-5xl px-6 py-14">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C9A84C]">Know before you play</p>
        <h2 id="player-protection-title" className="mt-2 text-2xl font-bold text-white">
          Clear rules. Protected results.
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
        Funding, withdrawals, and cash-prize contests require verified identity, supported location, and applicable account eligibility.
      </p>
    </section>
  );
}
