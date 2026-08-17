import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Crown, Zap, Shield, CircleCheck, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "@/components/Logo";
import SEO from "@/components/seo/SEO";
import { SITE_URL } from "@/lib/seoConfig";

const NotifyAtLaunchModal = lazy(() => import("@/components/NotifyAtLaunchModal"));
const HowItWorksSection = lazy(() => import("@/components/landing/HowItWorksSection"));
const PlayerProtectionCallout = lazy(() => import("@/components/landing/PlayerProtectionCallout"));

const LANDING_URL = `${SITE_URL}/`;
const SEO_TITLE = "Play Chess for Real Money — Head-to-Head Cash Contests | ChessBet";
const SEO_DESCRIPTION =
  "Play head-to-head blitz, rapid, and classical chess for real money on ChessBet, with server-verified games, Stockfish screening, and human fair-play review.";

const HERO_FEATURES = [
  {
    id: "fund-your-wallet",
    icon: WalletCards,
    label: "Fund your\nwallet",
    heading: "Add funds securely",
    description: "Fund your ChessBet wallet before entering a cash challenge.",
    points: ["Cash funding after Early Access", "Supported U.S. locations only", "Eligibility checked before funding"],
  },
  {
    id: "create-your-challenge",
    icon: Zap,
    label: "Create your\nchallenge",
    heading: "Set the match terms",
    description: "Choose the entry amount and time control, then invite an opponent.",
    points: ["Clear terms", "Head-to-head", "Blitz, rapid, or classical"],
  },
  {
    id: "play-to-win",
    icon: Crown,
    label: "Play to\nwin",
    heading: "Skill decides the prize",
    description: "Win the match. Win the cash prize.",
    points: ["Chess only", "Your result counts", "Cash-prize play is coming soon"],
  },
  {
    id: "fair-play",
    icon: Shield,
    label: "Fair play\nprotected",
    heading: "Built for fair play",
    description: "Game results are verified and concerns get human review.",
    points: ["Verified games", "Fair-play screening", "Human review"],
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
    name: "ChessBet head-to-head chess contests",
    description: "Skill-based head-to-head blitz, rapid, and classical chess contests with server-verified games, Stockfish screening, human fair-play review, and an appeals path.",
    category: "Skill-based online chess competition",
    brand: { "@id": `${SITE_URL}/#organization` },
    url: LANDING_URL,
  },
  {
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": `${LANDING_URL}#service`,
    name: "ChessBet skill-based chess competitions",
    description: "Head-to-head blitz, rapid, and classical chess competitions with server-verified games, Stockfish screening, and a human review and appeals path.",
    provider: { "@id": `${SITE_URL}/#organization` },
    isRelatedTo: { "@id": `${LANDING_URL}#product` },
    areaServed: "US",
    audience: { "@type": "Audience", audienceType: "Blitz, rapid, and classical chess players" },
    url: LANDING_URL,
  },
];

function DeferredLandingSection({ children, minHeight, className = "" }) {
  const containerRef = useRef(null);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setShouldRender(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShouldRender(true);
        observer.disconnect();
      },
      { rootMargin: "100px 0px", threshold: 0.01 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={shouldRender ? undefined : { minHeight }}
    >
      {shouldRender ? <Suspense fallback={null}>{children}</Suspense> : null}
    </div>
  );
}

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
          style={{ "--pulse-x": `${pulse.x}px`, "--pulse-y": `${pulse.y}px` }}
          onAnimationEnd={() => setPulse(null)}
        />
      )}
      <div className="landing-ambient-shade absolute inset-0" />
    </div>
  );
}

export default function Landing() {
  const [notifyModalOpen, setNotifyModalOpen] = useState(false);
  const [expandedFeature, setExpandedFeature] = useState(null);
  const activeFeature = HERO_FEATURES.find(({ id }) => id === expandedFeature);
  const ActiveFeatureIcon = activeFeature?.icon;

  return (
    <div className="relative isolate min-h-screen overflow-x-hidden bg-[#0A0A0A] flex flex-col">
      <SEO
        title={SEO_TITLE}
        description={SEO_DESCRIPTION}
        canonicalUrl={LANDING_URL}
        imageAlt="ChessBet — skill-based online chess contests"
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
          <div className="space-y-8 max-w-md">
            <div className="space-y-4">
              <Logo size="lg" className="justify-center" />
              <h1 className="text-white text-3xl sm:text-4xl font-extrabold leading-tight max-w-md mx-auto">
                Play chess. Win cash.
              </h1>
              <p className="text-white/70 text-lg font-semibold leading-snug max-w-sm mx-auto">
                Blitz, Rapid, and Classical Chess protected by Stockfish.
              </p>
              <p className="text-white/60 text-sm leading-relaxed max-w-sm mx-auto">
                No luck. No bots. Fair-play review when you need it.
              </p>
            </div>

            <div>
              <Link to="/register">
                <Button
                  size="lg"
                  className="w-full gold-gradient text-black font-bold text-lg h-14 rounded-2xl hover:opacity-90 transition-opacity"
                >
                  Join early access
                </Button>
              </Link>
              <p className="mt-3 text-xs leading-relaxed text-white/60">
                Cash play will be limited to supported U.S. locations when it launches — check eligibility before you fund your account in the{" "}
                <Link to="/official-rules#eligibility" className="font-semibold text-[#C9A84C] hover:underline underline-offset-4">Official Rules</Link>.
              </p>
              <Link to="/fair-play-integrity#fair-play-and-appeals" className="mt-4 inline-flex text-sm font-semibold text-[#C9A84C] hover:underline underline-offset-4">
                See how fair play and appeals work
              </Link>
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
            Cash-prize play launches after Early Access.{" "}
            <button
              onClick={() => setNotifyModalOpen(true)}
              className="text-[#C9A84C] font-semibold hover:underline underline-offset-2"
            >
              Get notified.
            </button>
          </p>
        </section>

        <DeferredLandingSection minHeight="520px">
          <HowItWorksSection />
        </DeferredLandingSection>

        <DeferredLandingSection minHeight="340px">
          <PlayerProtectionCallout />
        </DeferredLandingSection>
      </main>

      <footer className="relative z-10 px-6 py-8 text-center border-t border-white/5">
        <nav aria-label="ChessBet information" className="mb-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs">
          <Link to="/blog" className="text-white/55 hover:text-[#C9A84C]">Blog</Link>
          <Link to="/fair-play-integrity" className="text-white/55 hover:text-[#C9A84C]">Fair Play & Integrity</Link>
          <Link to="/official-rules" className="text-white/55 hover:text-[#C9A84C]">Official Rules</Link>
          <Link to="/faq" className="text-white/55 hover:text-[#C9A84C]">FAQ</Link>
          <Link to="/terms-of-service" className="text-white/55 hover:text-[#C9A84C]">Terms</Link>
          <Link to="/privacy-policy" className="text-white/55 hover:text-[#C9A84C]">Privacy</Link>
        </nav>
        <p className="text-white/45 text-xs">© 2026 ChessBet. All rights reserved.</p>
      </footer>

      {notifyModalOpen && (
        <Suspense fallback={null}>
          <NotifyAtLaunchModal open={notifyModalOpen} onOpenChange={setNotifyModalOpen} />
        </Suspense>
      )}
    </div>
  );
}
