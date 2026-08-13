import React from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Logo from "@/components/Logo";
import SEO from "@/components/seo/SEO";
import { SITE_URL } from "@/lib/seoConfig";

const PAGES = {
  "/features": {
    title: "Fair-Play Features for Cash Chess | ChessBet",
    description: "See ChessBet's server-verified games, Stockfish screening, human review, and appeals path for head-to-head blitz and rapid chess.",
    heading: "Head-to-head chess, built around fair play",
    intro: "Play blitz and rapid against real players. Your moves and result are server-verified, then screening and human review help protect the match.",
    points: ["Server-verified games and synchronized clocks", "Stockfish screening for engine-detection signals", "A report, evidence review, dispute, and appeal path if you think you were cheated"],
  },
  "/pricing": {
    title: "ChessBet Early Access & Cash-Play Fees | ChessBet",
    description: "ChessBet Early Access is currently demo-only. Learn how clear contest terms and transparent platform fees will work before cash-prize play launches.",
    heading: "Clear terms before you play",
    intro: "Early Access uses demo funds. Cash-prize play, ACH funding, withdrawals, and settlement are not live yet.",
    points: ["Every contest will show the entry amount and platform service fee before you commit", "The winner of a decisive contest receives the combined contest entry amounts", "Check eligibility before funding an account when cash play launches"],
  },
};

export default function MarketingInfo() {
  const { pathname } = useLocation();
  const page = PAGES[pathname] || PAGES["/features"];
  const serviceSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "ChessBet skill-based chess competitions",
    description: page.description,
    provider: { "@id": `${SITE_URL}/#organization` },
    url: `${SITE_URL}${pathname}`,
  };

  return (
    <main className="min-h-screen bg-[#0A0A0A] px-5 py-10 text-white">
      <SEO title={page.title} description={page.description} canonicalUrl={`${SITE_URL}${pathname}`} structuredData={serviceSchema} />
      <div className="mx-auto max-w-2xl">
        <Link to="/" className="inline-block"><Logo size="sm" /></Link>
        <Link to="/" className="mt-8 inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white"><ArrowLeft size={16} /> Back to ChessBet</Link>
        <section className="mt-10 rounded-3xl border border-[#C9A84C]/20 bg-gradient-to-br from-[#151310] to-[#0F0F0F] p-7 sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C9A84C]">ChessBet</p>
          <h1 className="mt-3 text-3xl font-extrabold leading-tight">{page.heading}</h1>
          <p className="mt-5 text-base leading-relaxed text-white/65">{page.intro}</p>
          <ul className="mt-7 space-y-3 text-sm leading-relaxed text-white/70">
            {page.points.map((point) => <li key={point} className="flex gap-3"><span className="text-[#C9A84C]">•</span><span>{point}</span></li>)}
          </ul>
        </section>
      </div>
    </main>
  );
}
