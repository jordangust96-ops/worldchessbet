import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { Crown, Zap, Shield, CircleCheck, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import NotifyAtLaunchModal from "@/components/NotifyAtLaunchModal";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import PlayerProtectionCallout from "@/components/landing/PlayerProtectionCallout";
import Logo from "@/components/Logo";
import SEO from "@/components/seo/SEO";
import { SITE_URL } from "@/lib/seoConfig";

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

function LandingAmbientGlow() {
  const reduceMotion = useReducedMotion();
  const [pulse, setPulse] = useState(null);
  const { scrollYProgress } = useScroll();
  const scrollDrift = useTransform(scrollYProgress, [0, 1], ["-3%", "3%"]);
  const perimeterMask = {
    WebkitMaskImage:
      "radial-gradient(ellipse 78% 76% at 50% 45%, transparent 0%, transparent 56%, rgba(0,0,0,0.3) 74%, black 94%)",
    maskImage:
      "radial-gradient(ellipse 78% 76% at 50% 45%, transparent 0%, transparent 56%, rgba(0,0,0,0.3) 74%, black 94%)",
  };

  useEffect(() => {
    if (reduceMotion) return undefined;

    const handleClick = (event) => {
      // Ignore keyboard-generated clicks, which do not have a meaningful
      // viewport coordinate for the ambient droplet.
      if (event.detail === 0) return;
      setPulse({ id: Date.now(), x: event.clientX, y: event.clientY });
    };

    window.addEventListener("click", handleClick, { passive: true });
    return () => window.removeEventListener("click", handleClick);
  }, [reduceMotion]);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden="true"
    >
      <motion.div
        className="absolute inset-0"
        style={{ y: reduceMotion ? 0 : scrollDrift }}
      >
        <motion.div
          className="absolute -inset-[32%]"
          style={{
            ...perimeterMask,
            background:
              "conic-gradient(from 25deg at 50% 50%, transparent 0deg, rgba(225,193,101,0.085) 38deg, transparent 82deg, transparent 164deg, rgba(201,168,76,0.055) 214deg, transparent 266deg, transparent 360deg)",
            willChange: reduceMotion ? "auto" : "transform, opacity",
          }}
          animate={
            reduceMotion
              ? { opacity: 0.42, rotate: -7 }
              : {
                  rotate: [-7, 14, -7],
                  scale: [0.985, 1.055, 0.985],
                  opacity: [0.32, 0.5, 0.32],
                }
          }
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 32, repeat: Infinity, ease: "easeInOut" }
          }
        />

        <motion.div
          className="absolute -inset-[12%]"
          style={{
            ...perimeterMask,
            background:
              "radial-gradient(ellipse 38% 46% at 2% 18%, rgba(225,193,101,0.105), transparent 72%), radial-gradient(ellipse 42% 48% at 98% 68%, rgba(201,168,76,0.09), transparent 74%), radial-gradient(ellipse 34% 34% at 28% 100%, rgba(201,168,76,0.055), transparent 76%)",
            willChange: reduceMotion ? "auto" : "transform, opacity",
          }}
          animate={
            reduceMotion
              ? { opacity: 0.52 }
              : {
                  x: ["-3%", "3.5%", "-1.5%", "-3%"],
                  y: ["-2%", "3%", "1%", "-2%"],
                  scale: [0.985, 1.045, 0.99, 0.985],
                  opacity: [0.4, 0.6, 0.46, 0.4],
                }
          }
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 24, repeat: Infinity, ease: "easeInOut" }
          }
        />
      </motion.div>

      {pulse && (
        <motion.div
          key={pulse.id}
          className="absolute inset-0"
          style={{
            ...perimeterMask,
            background: `radial-gradient(circle at ${pulse.x}px ${pulse.y}px, rgba(225,193,101,0.18) 0%, rgba(201,168,76,0.07) 18%, transparent 46%)`,
            transformOrigin: `${pulse.x}px ${pulse.y}px`,
            willChange: "transform, opacity",
          }}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: [0, 0.5, 0], scale: [0.97, 1.025, 1.07] }}
          transition={{ duration: 1.3, ease: "easeOut" }}
          onAnimationComplete={() => setPulse(null)}
        />
      )}

      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 76% 78% at 50% 45%, rgba(10,10,10,0.985) 0%, rgba(10,10,10,0.94) 58%, rgba(10,10,10,0.55) 76%, transparent 94%)",
        }}
      />
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

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5">
        <Logo size="md" />
        <Link to="/login">
          <Button variant="ghost" className="text-white/70 hover:text-white text-sm">
            Sign In
          </Button>
        </Link>
      </header>

      {/* Hero */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="space-y-8 max-w-md"
        >
          <div className="space-y-4">
            <Logo size="lg" className="justify-center" />
            <h1 className="text-white text-3xl sm:text-4xl font-extrabold leading-tight max-w-md mx-auto">
              Play chess. Win cash.
            </h1>
            <p className="text-white/70 text-lg font-semibold leading-snug max-w-sm mx-auto">
              Blitz, Rapid, and Classical Chess protected by Stockfish.
            </p>
            <p className="text-white/50 text-sm leading-relaxed max-w-sm mx-auto">
              No luck. No bots. Fair-play review when you need it.
            </p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            <Link to="/register">
              <Button
                size="lg"
                className="w-full gold-gradient text-black font-bold text-lg h-14 rounded-2xl hover:opacity-90 transition-opacity"
              >
                Join early access
              </Button>
            </Link>
            <p className="mt-3 text-xs leading-relaxed text-white/45">
              Cash play will be limited to supported U.S. locations when it launches — check eligibility before you fund your account in the{" "}
              <Link to="/official-rules#eligibility" className="font-semibold text-[#C9A84C] hover:underline underline-offset-4">Official Rules</Link>.
            </p>
            <Link to="/fair-play-integrity#fair-play-and-appeals" className="mt-4 inline-flex text-sm font-semibold text-[#C9A84C] hover:underline underline-offset-4">
              See how fair play and appeals work
            </Link>
            <p className="text-white/30 text-xs mt-4">
              Already have an account?{" "}
              <Link to="/login" className="text-[#C9A84C] hover:underline">
                Sign in
              </Link>
            </p>
          </motion.div>

        </motion.div>

        {/* Features */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          className="grid grid-cols-4 gap-3 mt-16 max-w-md w-full"
        >
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
                <span className="text-[10px] text-white/50 font-medium text-center whitespace-pre-line leading-tight sm:text-[11px]">
                  {label}
                </span>
              </button>
            );
          })}
        </motion.div>

        <AnimatePresence initial={false} mode="wait">
          {activeFeature && ActiveFeatureIcon && (
            <motion.div
              id={`hero-feature-details-${activeFeature.id}`}
              key={activeFeature.id}
              initial={{ opacity: 0, height: 0, y: -6 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: -6 }}
              transition={{ duration: 0.24, ease: "easeOut" }}
              className="max-w-md w-full overflow-hidden text-left"
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
                    <p className="mt-1.5 text-xs leading-relaxed text-white/50">
                      {activeFeature.description}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 border-t border-white/[0.06] pt-4">
                  {activeFeature.points.map((point) => (
                    <div key={point} className="flex items-center gap-2 text-[11px] text-white/55">
                      <CircleCheck size={13} className="shrink-0 text-[#C9A84C]/80" aria-hidden="true" />
                      <span>{point}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <p className="text-white/35 text-xs mt-8 max-w-sm">
          Cash-prize play launches after Early Access.{" "}
          <button
            onClick={() => setNotifyModalOpen(true)}
            className="text-[#C9A84C] font-semibold hover:underline underline-offset-2"
          >
            Get notified.
          </button>
        </p>
      </div>

      <div className="relative z-10">
        <HowItWorksSection />
      </div>

      <PlayerProtectionCallout />

      {/* Footer */}
      <footer className="relative z-10 px-6 py-8 text-center border-t border-white/5">
        <nav aria-label="ChessBet information" className="mb-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs">
          <Link to="/blog" className="text-white/45 hover:text-[#C9A84C]">Blog</Link>
          <Link to="/fair-play-integrity" className="text-white/45 hover:text-[#C9A84C]">Fair Play & Integrity</Link>
          <Link to="/official-rules" className="text-white/45 hover:text-[#C9A84C]">Official Rules</Link>
          <Link to="/faq" className="text-white/45 hover:text-[#C9A84C]">FAQ</Link>
          <Link to="/terms-of-service" className="text-white/45 hover:text-[#C9A84C]">Terms</Link>
          <Link to="/privacy-policy" className="text-white/45 hover:text-[#C9A84C]">Privacy</Link>
        </nav>
        <p className="text-white/20 text-xs">
          © 2026 ChessBet. All rights reserved.
        </p>
      </footer>

      <NotifyAtLaunchModal open={notifyModalOpen} onOpenChange={setNotifyModalOpen} />
    </div>
  );
}