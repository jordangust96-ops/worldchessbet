import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import SEO from "@/components/seo/SEO";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { SITE_URL } from "@/lib/seoConfig";
import {
  FAIR_PLAY_METADATA,
  FAIR_PLAY_OVERVIEW,
  FAIR_PLAY_SECTIONS,
  FAIR_PLAY_SUPPORT_EMAIL,
} from "@/lib/fairPlayPolicyContent";

const linkStyles = "font-semibold text-[#E5CA7A] underline underline-offset-4 hover:text-white";

export default function FairPlayIntegrity() {
  const { hash } = useLocation();
  const [openSections, setOpenSections] = useState([]);

  useEffect(() => {
    if (!hash) return undefined;

    let targetId = hash.slice(1);
    try {
      targetId = decodeURIComponent(targetId);
    } catch {
      // Keep the raw hash when it is not valid encoded text.
    }

    if (FAIR_PLAY_SECTIONS.some(({ id }) => id === targetId)) {
      setOpenSections((current) => current.includes(targetId) ? current : [...current, targetId]);
    }

    const timer = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: "start" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [hash]);

  return (
    <div className="min-h-screen bg-[#0A0A0A] pb-16">
      <SEO
        {...FAIR_PLAY_METADATA}
        canonicalUrl={`${SITE_URL}/fair-play-integrity`}
        structuredData={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "ChessBet Fair Play & Integrity",
          description: FAIR_PLAY_METADATA.description,
          url: `${SITE_URL}/fair-play-integrity`,
        }}
      />
      <header className="sticky top-0 z-10 border-b border-white/5 bg-[#0A0A0A]/95 px-5 py-4 backdrop-blur">
        <Link to="/profile" className="mb-3 inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white">
          <ArrowLeft size={14} /> Back to Profile
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#C9A84C]/10">
            <ShieldCheck size={18} className="text-[#C9A84C]" />
          </div>
          <h1 className="text-xl font-extrabold text-white">Fair Play &amp; Integrity Policy</h1>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-5 px-5 pt-6">
        <section id="fair-play-and-appeals" aria-label="Fair play overview"
          className="scroll-mt-28 space-y-3 rounded-2xl border border-[#C9A84C]/25 bg-[#C9A84C]/[0.07] p-4 sm:p-5">
          <p className="text-sm leading-relaxed text-white/85">{FAIR_PLAY_OVERVIEW}</p>
          <nav aria-label="Fair play help" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <Link to="#11-reporting-fair-play-concerns" className={linkStyles}>How to report</Link>
            <Link to="#appeals" className={linkStyles}>How to appeal</Link>
          </nav>
        </section>

        <Accordion type="multiple" value={openSections} onValueChange={setOpenSections} className="space-y-2">
          {FAIR_PLAY_SECTIONS.map(({ id, title, items }) => (
            <AccordionItem key={id} value={id} id={id}
              className="scroll-mt-28 rounded-2xl border border-white/10 bg-white/[0.03] px-4 sm:px-5">
              <AccordionTrigger className="gap-3 text-left text-base font-bold leading-snug text-white hover:no-underline">
                {title}
              </AccordionTrigger>
              <AccordionContent>
                <ul className="list-disc space-y-3 pl-5 text-sm leading-relaxed text-white/80 marker:text-[#C9A84C]">
                  {items.map(([label, text]) => (
                    <li key={label} className="pl-1">
                      <strong className="block font-semibold text-white">{label}</strong>
                      {text}
                    </li>
                  ))}
                </ul>
                {id === "appeals" && (
                  <a href={`mailto:${FAIR_PLAY_SUPPORT_EMAIL}`} className={`mt-3 inline-block pl-5 ${linkStyles}`}>
                    {FAIR_PLAY_SUPPORT_EMAIL}
                  </a>
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <nav aria-label="Related policies" className="flex flex-wrap gap-x-5 gap-y-2 border-t border-white/10 pt-4 text-sm">
          <Link to="/official-rules" className={linkStyles}>Official Rules</Link>
          <Link to="/terms-of-service" className={linkStyles}>Terms of Service</Link>
          <Link to="/privacy-policy" className={linkStyles}>Privacy Policy</Link>
        </nav>
      </div>
    </div>
  );
}
