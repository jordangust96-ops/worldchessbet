import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, HelpCircle } from "lucide-react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import Logo from "@/components/Logo";
import SEO from "@/components/seo/SEO";
import { SITE_URL } from "@/lib/seoConfig";
import { FAQ_SECTIONS, getFaqJsonLdEntities } from "@/lib/faqContent";
import { useAuth } from "@/lib/AuthContext";
import PlayerProtectionCallout from "@/components/landing/PlayerProtectionCallout";

export default function FAQ() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const targetAnswerId = location.hash.slice(1);

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: getFaqJsonLdEntities(),
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] px-5 py-10">
      <SEO
        title="Chess for Cash FAQ | Eligibility, Payouts & Fair Play — ChessBet"
        description="Get clear answers about ChessBet eligibility, ACH funding, cash-prize settlement, withdrawals, disputes, server-verified matches, and fair-play review."
        canonicalUrl={`${SITE_URL}/faq`}
        structuredData={structuredData}
      />
      <div className="max-w-2xl mx-auto space-y-6">
        <Link to="/" className="inline-block">
          <Logo size="sm" />
        </Link>

        <button
          onClick={() => (isAuthenticated ? navigate("/profile") : navigate(-1))}
          className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white transition-colors"
        >
          <ChevronLeft size={16} />
          Back
        </button>

        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-full gold-gradient flex items-center justify-center mx-auto">
            <HelpCircle size={24} className="text-black" />
          </div>
          <h1 className="text-2xl font-bold text-white">Frequently Asked Questions</h1>
          <p className="text-sm text-white/40">Everything you need to know about ChessBet</p>
        </div>

        <PlayerProtectionCallout />

        <section id="contact" aria-labelledby="support-title" className="rounded-2xl border border-[#C9A84C]/20 bg-white/[0.03] p-5 space-y-2">
          <h2 id="support-title" className="text-base font-semibold text-white">Contact ChessBet support</h2>
          <p className="text-sm leading-6 text-white/60">For account, contest, or payment questions, email our support team.</p>
          <a href="mailto:hello@worldchessbet.com" className="inline-block break-all text-sm font-medium text-[#C9A84C] underline underline-offset-4">hello@worldchessbet.com</a>
          <p className="text-xs leading-5 text-white/45">Do not email passwords, full bank details, or identity documents.</p>
        </section>

        <div className="space-y-6">
          {FAQ_SECTIONS.map((section) => (
            <div
              key={section.category}
              className="rounded-2xl bg-white/[0.03] border border-white/5 p-5"
            >
              <h2 className="text-xs font-semibold text-[#C9A84C] uppercase tracking-wider mb-2">
                {section.category}
              </h2>
              <Accordion
                type="single"
                collapsible
                defaultValue={section.items.some((item) => item.id === targetAnswerId) ? targetAnswerId : undefined}
                className="w-full"
              >
                {section.items.map((item, idx) => (
                  <AccordionItem
                    key={item.question}
                    value={item.id || `${section.category}-${idx}`}
                    id={item.id}
                    className="border-white/5 scroll-mt-28"
                  >
                    <AccordionTrigger className="text-white text-sm font-medium hover:no-underline">
                      {item.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-white/60 text-sm space-y-2">
                      {item.list ? (
                        <ol className="list-decimal list-inside space-y-1">
                          {item.list.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ol>
                      ) : (
                        item.paragraphs.map((p, i) => <p key={i}>{p}</p>)
                      )}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}