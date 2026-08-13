import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { Crown, Zap, Shield, CircleCheck, MapPin, Scale, SearchCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import NotifyAtLaunchModal from "@/components/NotifyAtLaunchModal";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import Logo from "@/components/Logo";
import SEO from "@/components/seo/SEO";
import { SITE_URL } from "@/lib/seoConfig";

const LANDING_URL = `${SITE_URL}/`;
const SEO_TITLE = "Competitive Online Chess | Integrity-First Early Access — ChessBet";
const SEO_DESCRIPTION =
  "Join ChessBet Early Access for head-to-head blitz and rapid chess with fair-play screening, clear rules, and human integrity review.";

const HERO_FEATURES = [
  {
    id: "instant-matching",
    icon: Zap,
    label: "Instant\nMatching",
    heading: "Find the right contest quickly",
    description:
      "Browse available challenges or create your own with the Entry Amount and time control shown upfront.",
    points: ["Clear challenge terms", "Fast marketplace updates", "Shared pre-match confirmation"],
  },
  {
    id: "secure-funds",
    icon: Shield,
    label: "Secure\nFunds",
    heading: "Contest funds are tracked end to end",
    description:
      "Each player's Entry Amount and separately disclosed Platform Service Fee are reserved before play and recorded through settlement.",
    points: ["Server-controlled reservation", "Auditable transaction records", "Automatic result-based settlement"],
  },
  {
    id: "verified-results",
    icon: Crown,
    label: "Verified\nResults",
    heading: "Every result follows the game record",
    description:
      "Legal moves, chess clocks, and final results are server-authoritative, with automated fair-play screening supporting human review.",
    points: ["Authoritative move and clock history", "Stockfish post-game screening", "Admin integrity review"],
  },
];

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "@id": `${LANDING_URL}#webpage`,
  url: LANDING_URL,
  name: SEO_TITLE,
  description: SEO_DESCRIPTION,
  isPartOf: { "@id": `${SITE_URL}/#website` },
  about: { "@id": `${SITE_URL}/#organization` },
  inLanguage: "en-US",
};

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
            <h1 className="text-white text-2xl sm:text-3xl font-extrabold leading-tight max-w-md mx-auto">
              Win head-to-head chess matches. Earn prizes for skill.
            </h1>
            <p className="text-white/70 text-lg font-semibold leading-snug max-w-sm mx-auto">
              Play competitive blitz and rapid chess in prize-based contests, with server-verified results, fair-play screening, and human review when something looks wrong.
            </p>
            <p className="text-white/50 text-sm leading-relaxed max-w-sm mx-auto">
              Early Access: prize-based competition, funding, withdrawals, and settlement are not yet live. Availability will depend on eligibility and location.
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
                Claim your founding spot
              </Button>
            </Link>
            <Link to="/fair-play-integrity" className="mt-4 inline-flex text-sm font-semibold text-[#C9A84C] hover:underline underline-offset-4">
              Read the Fair Play rules
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
          className="grid grid-cols-3 gap-4 mt-16 max-w-sm w-full"
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
                className="relative flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/[0.03] border border-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A84C]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0A]"
              >
                <Icon size={20} className="text-[#C9A84C]" aria-hidden="true" />
                <span className="text-[11px] text-white/50 font-medium text-center whitespace-pre-line leading-tight">
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
              className="max-w-sm w-full overflow-hidden text-left"
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
          Early Access: ChessBet is currently in early access. Real-money competitive play will be
          available soon.{" "}
          <button
            onClick={() => setNotifyModalOpen(true)}
            className="text-[#C9A84C] font-semibold hover:underline underline-offset-2"
          >
            Get notified when real-money competitive play launches.
          </button>
        </p>
      </div>

      <div className="relative z-10">
        <HowItWorksSection />
      </div>

      <section aria-labelledby="early-access-answers" className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-14">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C9A84C]">Before you join</p>
            <h2 id="early-access-answers" className="mt-2 text-2xl font-bold text-white">Clear rules, visible safeguards, and a path to review.</h2>
            <p className="mt-3 text-sm leading-relaxed text-white/60">Early Access is intentionally limited while ChessBet validates the competitive experience and integrity process.</p>
          </div>
          <div className="mt-7 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-5">
              <MapPin className="text-[#C9A84C]" size={20} aria-hidden="true" />
              <h3 className="mt-4 font-semibold text-white">Eligibility comes first</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/55">Participation depends on eligibility and location checks. Review the Official Rules before joining.</p>
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-5">
              <Scale className="text-[#C9A84C]" size={20} aria-hidden="true" />
              <h3 className="mt-4 font-semibold text-white">Early Access is not live settlement</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/55">Funding, withdrawals, and real-money settlement are disabled during Early Access. Product status and rules are shown clearly.</p>
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-5">
              <SearchCheck className="text-[#C9A84C]" size={20} aria-hidden="true" />
              <h3 className="mt-4 font-semibold text-white">Cheating has a review path</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/55">Fair-play signals support human review. Players can report concerns under the Fair Play Integrity process.</p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <Link to="/official-rules" className="font-semibold text-[#C9A84C] hover:underline underline-offset-4">Read Official Rules</Link>
            <Link to="/fair-play-integrity" className="font-semibold text-[#C9A84C] hover:underline underline-offset-4">How Fair Play Integrity works</Link>
            <Link to="/faq" className="font-semibold text-[#C9A84C] hover:underline underline-offset-4">Read FAQs</Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 px-6 py-8 text-center border-t border-white/5">
        <nav aria-label="ChessBet information" className="mb-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs">
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