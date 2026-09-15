import React, { useEffect, useState } from "react";
import { openCookieSettings } from "@/lib/privacy";
import { Link } from "react-router-dom";
import { Banknote, Crown, Zap, CircleCheck, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "@/components/Logo";
import SEO from "@/components/seo/SEO";
import { SITE_URL } from "@/lib/seoConfig";

import HowItWorksSection from "@/components/landing/HowItWorksSection";
import PlayerProtectionCallout from "@/components/landing/PlayerProtectionCallout";

const LANDING_URL = `${SITE_URL}/`;
const SEO_TITLE = "Play Chess for Real Money — Head-to-Head Cash Contests | ChessBet";
const SEO_DESCRIPTION =
  "Play head-to-head blitz, rapid, or classical chess for real USD. Choose an entry amount, win a decisive match, and take the full cash prize—with fair-play protection built in. Start free worldwide with no deposit, or compete for real money where eligible.";

const HERO_FEATURES = [
  {
    id: "choose-your-entry",
    icon: WalletCards,
    label: "Choose your\nentry",
    heading: "Put your confidence on the board",
    description: "Pick an entry amount that makes the match matter.",
    points: ["Entry amounts in USD", "Clear terms before play", "You choose the amount"],
  },
  {
    id: "create-your-challenge",
    icon: Zap,
    label: "Create your\nchallenge",
    heading: "Set the matchup",
    description: "Create a challenge or accept another player’s terms.",
    points: ["Head-to-head", "Blitz, Rapid, or Classical", "Your choice of time control"],
  },
  {
    id: "play-to-win",
    icon: Crown,
    label: "Play to\nwin",
    heading: "Let your chess decide",
    description: "Win a decisive match. Win the cash prize.",
    points: ["One player against another", "Every move matters", "Skill decides the result"],
  },
  {
    id: "win-real-usd",
    icon: Banknote,
    label: "Win real\nUSD",
    heading: "Real dollars—not tokens",
    description: "A confirmed winner earns 100% of the combined entry amounts.",
    points: ["No tokens", "No crypto", "Platform Service Fee shown separately"],
  },
];

const STRUCTURED_DATA = [
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${LANDING_URL}#webpage`,
    url: LANDING_URL,
    name: SEO_TITLE,
    description: SEO_DESCRIPTION,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    about: { "@id": `${SITE_URL}/#organization` },
    inLanguage: "en-US",
  },
  {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${LANDING_URL}#product`,
    name: "ChessBet chess for real money",
    description: "Head-to-head, skill-based blitz, rapid, and classical chess for real USD. Players choose entry amounts, and the confirmed winner of a decisive match receives the combined entry amounts, with fair-play protection built in.",
    category: "Skill-based online chess competition",
    brand: { "@id": `${SITE_URL}/#organization` },
    url: LANDING_URL,
  },
  {
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": `${LANDING_URL}#service`,
    name: "ChessBet real-money chess contests",
    description: "One-on-one, skill-based chess contests for real USD, backed by server-verified results, integrity screening, human review, and an appeals path.",
    provider: { "@id": `${SITE_URL}/#organization` },
    isRelatedTo: { "@id": `${LANDING_URL}#product` },
    areaServed: ["Arkansas", "Colorado", "Georgia", "Iowa", "Kansas", "North Dakota", "Texas", "Virginia", "Wisconsin", "Wyoming"],
    audience: { "@type": "Audience", audienceType: "Blitz, rapid, and classical chess players" },
    url: LANDING_URL,
  },
];

function LandingAmbientGlow() {
  const [pulse, setPulse] = useState(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    if (reduceMotion || mobile) return undefined;

    const handleClick = (event) => {
      if (event.detail === 0) return;
      setPulse({ id: Date.now(), x: event.clientX, y: event.clientY });
    };

    window.addEventListener("click", handleClick, { passive: true });
    return () => window.removeEventListener("click", handleClick);
  }, []);

  return (
    <div className="landing-ambient pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      <div className="landing-ambient-primary absolute -inset-[32%]" />
      <div className="landing-ambient-secondary absolute -inset-[12%]" />
      {pulse && (
        <div
          key={pulse.id}
          className="landing-ambient-pulse absolute inset-0"
          style={/** @type {any} */ ({ "--pulse-x": `${pulse.x}px`, "--pulse-y": `${pulse.y}px` })}
          onAnimationEnd={() => setPulse(null)}
        />
      )}
      <div className="landing-ambient-shade absolute inset-0" />
    </div>
  );
}

export default function Landing() {
  const [expandedFeature, setExpandedFeature] = useState(null);
  const activeFeature = HERO_FEATURES.find(({ id }) => id === expandedFeature);
  const ActiveFeatureIcon = activeFeature?.icon;

  return (
    <div
      className="relative isolate min-h-screen overflow-x-hidden bg-[#0A0A0A] flex flex-col"
      style={{ minHeight: "100svh" }}
    >
      <SEO
        title={SEO_TITLE}
        description={SEO_DESCRIPTION}
        canonicalUrl={LANDING_URL}
        imageAlt="ChessBet — chess for real money"
        structuredData={STRUCTURED_DATA}
      />
      <LandingAmbientGlow />

      <header className="relative z-10 flex items-center justify-between px-6 py-5">
        <Logo size="md" />
        <Link to="/login">
          <Button variant="ghost" className="text-white/70 hover:text-white text-sm">
            Sign In
          </Button>
        </Link>
      </header>

      <main className="relative z-10 flex flex-1 flex-col">
        <section className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="space-y-8 max-w-lg">
            <div className="space-y-4">
              <Logo size="lg" className="justify-center" />
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#C9A84C]">
                Chess for real money
              </p>
              <h1 className="text-white text-3xl sm:text-4xl font-extrabold leading-tight max-w-md mx-auto">
                Play chess. Win cash.
              </h1>
              <p className="text-white/75 text-lg font-semibold leading-snug max-w-lg mx-auto">
                One-on-one chess for real USD. Choose an entry amount, win a decisive match, and take the full cash prize.
              </p>
              <p className="text-white/55 text-sm leading-relaxed max-w-sm mx-auto">
                No crypto. No tokens. Your chess decides it.
              </p>
            </div>

            <div>
              <Link to="/register?mode=free">
                <Button
                  size="lg"
                  className="w-full gold-gradient text-black font-bold text-lg h-14 rounded-2xl hover:opacity-90 transition-opacity"
                >
                  Start playing free
                </Button>
              </Link>
              <p className="mt-2.5 text-xs leading-relaxed text-white/55">
                Play worldwide in minutes. No deposit, no verification — just create an account.
              </p>

              <Link to="/register?mode=money" className="mt-4 block">
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full h-12 rounded-2xl border border-[#C9A84C]/40 bg-transparent text-[#C9A84C] font-bold text-base hover:bg-[#C9A84C]/10 hover:text-[#C9A84C]"
                >
                  Play for real money
                </Button>
              </Link>
              <p className="mt-2.5 text-xs leading-relaxed text-white/55">
                Cash-prize contests require verified age 21+ and eligibility in supported U.S. locations — check eligibility before funding your account in the{" "}
                <Link to="/official-rules#eligibility" className="font-semibold text-[#C9A84C] hover:underline underline-offset-4">Official Rules</Link>.
              </p>

              <p className="text-white/50 text-xs mt-4">
                Already have an account?{" "}
                <Link to="/login" className="text-[#C9A84C] hover:underline">
                  Sign in
                </Link>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3 mt-16 max-w-md w-full">
            {HERO_FEATURES.map(({ id, icon: Icon, label }) => {
              const isExpanded = expandedFeature === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setExpandedFeature(isExpanded ? null : id)}
                  aria-expanded={isExpanded}
                  aria-controls={`hero-feature-details-${id}`}
                  className="relative flex min-w-0 flex-col items-center gap-2 rounded-2xl border border-white/5 bg-white/[0.03] px-2 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A84C]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0A] sm:px-3"
                >
                  <Icon size={20} className="text-[#C9A84C]" aria-hidden="true" />
                  <span className="text-[10px] text-white/60 font-medium text-center whitespace-pre-line leading-tight sm:text-[11px]">
                    {label}
                  </span>
                </button>
              );
            })}
          </div>

          {activeFeature && ActiveFeatureIcon && (
            <div
              id={`hero-feature-details-${activeFeature.id}`}
              className="landing-feature-details max-w-md w-full overflow-hidden text-left"
              role="region"
              aria-live="polite"
            >
              <div className="mt-3 rounded-2xl border border-[#C9A84C]/20 bg-gradient-to-br from-[#C9A84C]/[0.08] to-white/[0.02] p-5">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#C9A84C]/20 bg-[#C9A84C]/10">
                    <ActiveFeatureIcon size={18} className="text-[#C9A84C]" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-white">{activeFeature.heading}</h2>
                    <p className="mt-1.5 text-xs leading-relaxed text-white/60">
                      {activeFeature.description}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 border-t border-white/[0.06] pt-4">
                  {activeFeature.points.map((point) => (
                    <div key={point} className="flex items-center gap-2 text-[11px] text-white/60">
                      <CircleCheck size={13} className="shrink-0 text-[#C9A84C]/80" aria-hidden="true" />
                      <span>{point}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <p className="text-white/55 text-xs mt-8 max-w-sm">
            The fixed Platform Service Fee is separate from the Contest Prize. Winnings remain pending for the 24-hour reporting window and any unresolved review.
          </p>
        </section>

        <PlayerProtectionCallout />
        <HowItWorksSection />
      </main>

      <footer className="relative z-10 px-6 py-8 text-center border-t border-white/5">
        <nav aria-label="ChessBet information" className="mb-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs">
          <Link to="/about" className="text-white/55 hover:text-[#C9A84C]">About</Link>
          <Link to="/blog" className="text-white/55 hover:text-[#C9A84C]">Blog</Link>
          <Link to="/fair-play-integrity" className="text-white/55 hover:text-[#C9A84C]">Fair Play & Integrity</Link>
          <Link to="/official-rules" className="text-white/55 hover:text-[#C9A84C]">Official Rules</Link>
          <Link to="/faq" className="text-white/55 hover:text-[#C9A84C]">FAQ</Link>
          <Link to="/terms-of-service" className="text-white/55 hover:text-[#C9A84C]">Terms</Link>
          <Link to="/privacy-policy" className="text-white/55 hover:text-[#C9A84C]">Privacy</Link>
          <button onClick={openCookieSettings} className="text-white/55 hover:text-[#C9A84C]">Cookie settings</button>
        </nav>
        <p className="text-white/45 text-xs">© 2026 ChessBet. All rights reserved.</p>
      </footer>

    </div>
  );
}
