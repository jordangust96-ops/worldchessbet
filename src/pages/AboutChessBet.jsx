import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CircleCheck } from "lucide-react";
import Logo from "@/components/Logo";
import SEO from "@/components/seo/SEO";
import { SITE_URL } from "@/lib/seoConfig";

const ABOUT_TITLE = "About ChessBet | Fair, Skill-Based Head-to-Head Chess";
const ABOUT_DESCRIPTION =
  "Learn how ChessBet combines skill-based head-to-head chess, transparent contest terms, Early Access safeguards, and human-reviewed fair-play protection.";

const SECTIONS = [
  {
    id: "about-chessbet",
    eyebrow: "About ChessBet",
    heading: "Chess competition built around skill and fair play",
    intro:
      "ChessBet is building a head-to-head chess platform where transparent contest terms and fair-play protections come first.",
    points: [
      "Skill-based head-to-head blitz, rapid, and classical chess",
      "Clear contest terms before a player commits",
      "A documented report, dispute, and appeals path",
    ],
  },
  {
    id: "features",
    eyebrow: "Fair-play features",
    heading: "Every match is built for reviewable results",
    intro:
      "Moves, clocks, and results are server-verified. Screening signals and human review help protect players when a concern is reported.",
    points: [
      "Server-verified games and synchronized clocks",
      "Stockfish screening for engine-detection signals",
      "Evidence review by a person, with a clear appeals path",
    ],
  },
  {
    id: "early-access-and-fees",
    eyebrow: "Early Access and fees",
    heading: "Clear terms before cash play launches",
    intro:
      "Early Access uses demo funds. Cash-prize play, ACH funding, withdrawals, and settlement are not live yet.",
    points: [
      "Every future contest will show its entry amount and platform service fee before commitment",
      "The winner of a decisive contest receives the combined contest entry amounts",
      "Eligibility will be checked before funding is available in supported U.S. locations",
    ],
  },
];

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  "@id": `${SITE_URL}/about#webpage`,
  url: `${SITE_URL}/about`,
  name: ABOUT_TITLE,
  description: ABOUT_DESCRIPTION,
  isPartOf: { "@id": `${SITE_URL}/#website` },
  about: { "@id": `${SITE_URL}/#organization` },
  inLanguage: "en-US",
};

export default function AboutChessBet() {
  return (
    <main className="min-h-screen bg-[#0A0A0A] px-5 py-10 text-white">
      <SEO
        title={ABOUT_TITLE}
        description={ABOUT_DESCRIPTION}
        canonicalUrl={`${SITE_URL}/about`}
        structuredData={STRUCTURED_DATA}
      />
      <div className="mx-auto max-w-3xl">
        <Link to="/" className="inline-block">
          <Logo size="sm" />
        </Link>
        <Link
          to="/"
          className="mt-8 inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white"
        >
          <ArrowLeft size={16} /> Back to ChessBet
        </Link>

        <div className="mt-10 space-y-6">
          {SECTIONS.map((section, index) => (
            <section
              id={section.id}
              key={section.id}
              className="scroll-mt-6 rounded-3xl border border-[#C9A84C]/20 bg-gradient-to-br from-[#151310] to-[#0F0F0F] p-7 sm:p-10"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C9A84C]">
                {section.eyebrow}
              </p>
              {index === 0 ? (
                <h1 className="mt-3 text-3xl font-extrabold leading-tight">{section.heading}</h1>
              ) : (
                <h2 className="mt-3 text-2xl font-extrabold leading-tight">{section.heading}</h2>
              )}
              <p className="mt-5 text-base leading-relaxed text-white/65">{section.intro}</p>
              <ul className="mt-7 space-y-3 text-sm leading-relaxed text-white/70">
                {section.points.map((point) => (
                  <li key={point} className="flex gap-3">
                    <CircleCheck size={16} className="mt-0.5 shrink-0 text-[#C9A84C]" aria-hidden="true" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-white/45">
          Read the{" "}
          <Link to="/official-rules" className="font-semibold text-[#C9A84C] hover:underline">
            Official Rules
          </Link>{" "}
          and{" "}
          <Link to="/fair-play-integrity" className="font-semibold text-[#C9A84C] hover:underline">
            Fair Play & Integrity Policy
          </Link>{" "}
          for the complete details.
        </p>
      </div>
    </main>
  );
}
