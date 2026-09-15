import React, { useEffect, useState } from "react";
import { openCookieSettings } from "@/lib/privacy";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import Logo from "@/components/Logo";
import SEO from "@/components/seo/SEO";
import { SITE_URL } from "@/lib/seoConfig";


const LANDING_URL = `${SITE_URL}/`;
const SEO_TITLE = "Play Chess for Real Money — Or Start Free | ChessBet";
const SEO_DESCRIPTION =
  "Play head-to-head chess for real USD where eligible, or start free worldwide. Create an account, challenge a friend, and play blitz, rapid, or classical chess.";

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
          <Button variant="ghost" className="text-white/70 hover:text-white text-base">
            Sign In
          </Button>
        </Link>
      </header>

      <main className="relative z-10 flex flex-1 flex-col">
        <section className="mx-auto flex w-full max-w-5xl flex-col items-center px-6 pb-16 pt-12 text-center sm:pb-24 sm:pt-20">
          <p className="text-base font-semibold text-[#C9A84C]">One-on-one. Real USD.</p>
          <h1 className="mt-5 text-5xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-7xl">
            Play chess.<br /><span className="text-[#E5CA7A]">Win cash.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-lg text-xl leading-relaxed text-white/75">
            Bring your best game. Play for money where eligible, or start free.
          </p>
          <div className="mt-9 grid w-full max-w-lg gap-3 sm:grid-cols-2">
            <Button asChild size="lg" className="h-14 rounded-2xl gold-gradient text-lg font-bold text-black hover:opacity-90">
              <Link to="/register?mode=free">Play Free</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-14 rounded-2xl border-[#C9A84C]/60 bg-transparent text-lg font-bold text-[#E5CA7A] hover:bg-[#C9A84C]/10">
              <Link to="/register?mode=money">Play for Money</Link>
            </Button>
          </div>
          <p className="mt-5 text-base leading-relaxed text-white/65">Free worldwide. Just an account. No deposit.</p>
          <p className="mt-3 text-base leading-relaxed text-white/65">
            Money play: 21+ in supported U.S. locations.{" "}
            <Link to="/official-rules#eligibility" className="text-[#E5CA7A] underline underline-offset-4">Check eligibility</Link>
          </p>
        </section>

        <section aria-labelledby="make-it-a-match" className="border-t border-white/10 px-6 py-12 sm:py-16">
          <div className="mx-auto max-w-3xl">
            <h2 id="make-it-a-match" className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Your friend. Your rival.<br />Your next opponent.</h2>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">Choose your time control, share a challenge, and settle it on the board.</p>
            <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-lg font-semibold text-[#E5CA7A]">
              <span>Blitz</span><span>Rapid</span><span>Classical</span>
            </div>
            <details className="mt-10 border-t border-white/10 pt-6">
              <summary className="cursor-pointer text-lg font-semibold text-white marker:text-[#C9A84C]">How money play works</summary>
              <div className="mt-5 space-y-4 text-base leading-relaxed text-white/70">
                <p>Verify your eligibility and identity, connect your bank, and add funds. Choose an entry amount and review the separate Platform Service Fee before you play.</p>
                <p>The confirmed winner of a decisive match earns the combined entry amounts. Winnings remain pending for the 24-hour reporting window and any unresolved review.</p>
                <p>Free games need no identity verification, bank connection, location check, or deposit.</p>
                <Link to="/official-rules" className="inline-block text-[#E5CA7A] underline underline-offset-4">Read the Official Rules</Link>
              </div>
            </details>
            <Link to="/fair-play-integrity" className="mt-6 inline-block text-base font-medium text-[#E5CA7A] underline underline-offset-4">Fair play &amp; player protection</Link>
          </div>
        </section>
      </main>

      <footer className="relative z-10 px-6 py-8 text-center border-t border-white/5">
        <nav aria-label="ChessBet information" className="mb-4 flex flex-wrap justify-center gap-x-5 gap-y-3 text-base">
          <Link to="/about" className="text-white/55 hover:text-[#C9A84C]">About</Link>
          <Link to="/blog" className="text-white/55 hover:text-[#C9A84C]">Blog</Link>
          <Link to="/fair-play-integrity" className="text-white/55 hover:text-[#C9A84C]">Fair Play & Integrity</Link>
          <Link to="/official-rules" className="text-white/55 hover:text-[#C9A84C]">Official Rules</Link>
          <Link to="/faq" className="text-white/55 hover:text-[#C9A84C]">FAQ</Link>
          <Link to="/terms-of-service" className="text-white/55 hover:text-[#C9A84C]">Terms</Link>
          <Link to="/privacy-policy" className="text-white/55 hover:text-[#C9A84C]">Privacy</Link>
          <button onClick={openCookieSettings} className="text-white/55 hover:text-[#C9A84C]">Cookie settings</button>
        </nav>
        <p className="text-white/55 text-sm">© 2026 ChessBet. All rights reserved.</p>
      </footer>

    </div>
  );
}
