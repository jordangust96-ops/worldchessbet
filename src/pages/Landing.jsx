import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Crown, Zap, Shield } from "lucide-react";
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
          {[
            { icon: Zap, label: "Instant\nMatching" },
            { icon: Shield, label: "Secure\nFunds" },
            { icon: Crown, label: "Verified\nResults" },
          ].map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/[0.03] border border-white/5"
            >
              <Icon size={20} className="text-[#C9A84C]" />
              <span className="text-[11px] text-white/50 font-medium text-center whitespace-pre-line leading-tight">
                {label}
              </span>
            </div>
          ))}
        </motion.div>

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