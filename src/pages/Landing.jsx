import React, { useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Crown, Zap, Shield, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import NotifyAtLaunchModal from "@/components/NotifyAtLaunchModal";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import Logo from "@/components/Logo";
import SEO from "@/components/seo/SEO";
import { SITE_URL } from "@/lib/seoConfig";

const LANDING_URL = `${SITE_URL}/landing`;
const SEO_TITLE = "ChessBet | Play Online Chess for Real Prizes";
const SEO_DESCRIPTION =
  "Play skill-based, head-to-head online chess for real prizes with secure contest funds, verified results, and Stockfish-powered fair-play screening.";

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

export default function Landing() {
  const [notifyModalOpen, setNotifyModalOpen] = useState(false);
  const [expandedFeature, setExpandedFeature] = useState(null);
  const activeFeature = HERO_FEATURES.find(({ id }) => id === expandedFeature);
  const ActiveFeatureIcon = activeFeature?.icon;

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex flex-col">
      <SEO
        title={SEO_TITLE}
        description={SEO_DESCRIPTION}
        canonicalUrl={LANDING_URL}
        imageAlt="ChessBet — skill-based online chess contests"
        structuredData={STRUCTURED_DATA}
      />
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5">
        <Logo size="md" />
        <Link to="/login">
          <Button variant="ghost" className="text-white/70 hover:text-white text-sm">
            Sign In
          </Button>
        </Link>
      </header>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="space-y-8 max-w-md"
        >
          <div className="space-y-4">
            <Logo size="lg" className="justify-center" />
            <h1 className="text-white text-2xl sm:text-3xl font-extrabold leading-tight max-w-md mx-auto">
              Play Online Chess for Real Prizes
            </h1>
            <p className="text-white/70 text-xl font-semibold leading-snug max-w-sm mx-auto">
              Challenge. Compete. Win.
            </p>
            <p className="text-white/50 text-lg leading-relaxed max-w-sm mx-auto">
              Real Chess. Real Stakes.
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
                Get Started
              </Button>
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
                aria-controls="hero-feature-details"
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
              id="hero-feature-details"
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

      <HowItWorksSection />

      {/* Footer */}
      <footer className="px-6 py-8 text-center border-t border-white/5">
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