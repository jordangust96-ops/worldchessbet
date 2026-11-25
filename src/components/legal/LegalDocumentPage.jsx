import React, { useState, useEffect, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2, ArrowLeft } from "lucide-react";
import { base44 } from "@/api/base44Client";
import moment from "moment";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import ReactMarkdown from "react-markdown";
import PlatformServiceFeeScheduleTable from "@/components/legal/PlatformServiceFeeScheduleTable";
import { LEGAL_DOCUMENT_TYPES } from "@/lib/legalDocumentTypes";
import { getOfficialRulesBullets } from "@/lib/officialRulesFormatting";
import { getTermsOfServiceBullets } from "@/lib/termsOfServiceFormatting";
import SEO from "@/components/seo/SEO";
import { SITE_URL } from "@/lib/seoConfig";

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function parseSections(markdown, supportEmail) {
  const body = (markdown || "").replaceAll("{{SUPPORT_EMAIL}}", supportEmail || "support@worldchessbet.com");
  const parts = body.split(/\n(?=## )/g).filter((p) => p.trim().startsWith("## "));
  return parts.map((part) => {
    const [firstLine, ...rest] = part.split("\n");
    const title = firstLine.replace(/^##\s*/, "").trim();
    return { id: slugify(title), title, content: rest.join("\n").trim() };
  });
}

function FormattedLegalSection({ section, formatBullets }) {
  const bullets = formatBullets(section.title, section.content);
  const markdownStyles = "space-y-2 [&_a]:text-[#E5CA7A] [&_a]:underline [&_strong]:text-white [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5";
  if (!bullets) {
    return <div className={markdownStyles}><ReactMarkdown>{section.content}</ReactMarkdown></div>;
  }

  return (
    <ul className="list-disc space-y-3 pl-5 marker:text-[#C9A84C]">
      {bullets.map(({ label, text }) => (
        <li key={label} className="pl-1">
          <strong className="block font-semibold text-white">{label}</strong>
          <div className={markdownStyles}><ReactMarkdown>{text}</ReactMarkdown></div>
        </li>
      ))}
    </ul>
  );
}

// Generic viewer for any legal document type (Privacy Policy, Terms of
// Service, Official Rules). Content is driven entirely by the active
// PrivacyPolicyConfig record scoped to policyType.
export default function LegalDocumentPage({ policyType }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openSections, setOpenSections] = useState([]);
  const { hash } = useLocation();
  const docMeta = LEGAL_DOCUMENT_TYPES[policyType];
  const formatBullets = policyType === "official_rules" ? getOfficialRulesBullets
    : policyType === "terms_of_service" ? getTermsOfServiceBullets
    : null;

  useEffect(() => {
    const load = async () => {
      const configs = await base44.entities.PrivacyPolicyConfig.filter(
        { is_active: true, policy_type: policyType },
        "-version",
        1
      );
      setConfig(configs?.[0] || null);
      setLoading(false);
    };
    load();
  }, [policyType]);

  const sections = useMemo(
    () => (config ? parseSections(config.content_markdown, config.support_email) : []),
    [config]
  );

  useEffect(() => {
    if (loading || !hash) return undefined;

    const targetId = decodeURIComponent(hash.slice(1));
    if (sections.some((section) => section.id === targetId)) {
      setOpenSections((current) => current.includes(targetId) ? current : [...current, targetId]);
    }

    const timer = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);

    return () => window.clearTimeout(timer);
  }, [hash, loading, sections]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A]">
        <Loader2 className="animate-spin text-[#C9A84C]" size={28} />
      </div>
    );
  }

  const Icon = docMeta.icon;

  return (
    <div className="min-h-screen bg-[#0A0A0A] pb-16">
      <SEO
        title={docMeta.seoTitle}
        description={docMeta.seoDescription}
        canonicalUrl={`${SITE_URL}${docMeta.route}`}
        structuredData={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: docMeta.label,
          description: docMeta.seoDescription,
          url: `${SITE_URL}${docMeta.route}`,
          isPartOf: { "@type": "WebSite", name: "ChessBet", url: SITE_URL },
        }}
      />
      <div className="sticky top-0 z-10 bg-[#0A0A0A]/95 backdrop-blur border-b border-white/5 px-5 py-4">
        <Link to="/profile" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 mb-3">
          <ArrowLeft size={14} /> Back to Profile
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
            <Icon size={18} className="text-[#C9A84C]" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-white">{docMeta.label}</h1>
            <p className="text-xs text-white/40">
              Last Updated: {config?.last_updated ? moment(config.last_updated).format("MMMM D, YYYY") : "—"}
            </p>
          </div>
        </div>
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-5 pt-6 max-w-2xl mx-auto">
        {policyType === "official_rules" && (
          <section
            id="eligibility"
            aria-labelledby="eligibility-title"
            className="mb-6 scroll-mt-28 rounded-2xl border border-[#C9A84C]/25 bg-[#C9A84C]/[0.07] p-5"
          >
            <h2 id="eligibility-title" className="text-base font-bold text-white">Where can I play?</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-white/80 marker:text-[#C9A84C]">
              <li><strong className="text-white">Who can play.</strong> Cash-prize play requires identity verification, verified age 21+, U.S. residency, and physical presence in a supported location when entering and playing.</li>
              <li><strong className="text-white">Supported states.</strong> Arkansas, Colorado, Georgia, Iowa, Kansas, North Dakota, Texas, Virginia, Wisconsin, and Wyoming.</li>
              <li><strong className="text-white">Availability.</strong> ChessBet sets its own access policy, subject to applicable law and the Official Rules. A home address alone does not establish eligibility.</li>
            </ul>
          </section>
        )}

        {config?.full_document_url && (
          <a
            href={config.full_document_url}
            target="_blank"
            rel="noopener noreferrer"
            className="block mb-6 text-center text-xs font-semibold text-[#C9A84C] underline hover:text-[#E8D48B]"
          >
            View the full published document (PDF)
          </a>
        )}
        {sections.length === 0 ? (
          <p className="text-white/40 text-sm text-center py-10">{docMeta.label} content is not yet available.</p>
        ) : (
          <>
            <Accordion type="multiple" value={openSections} onValueChange={setOpenSections} className="space-y-2">
              {sections.map((s) => (
                <AccordionItem
                  key={s.id}
                  value={s.id}
                  id={s.id}
                  className="rounded-2xl bg-white/[0.03] border border-white/5 px-4 scroll-mt-24"
                >
                  <AccordionTrigger className="gap-3 text-left text-sm font-semibold leading-5 text-white hover:no-underline">
                    {s.title}
                  </AccordionTrigger>
                  <AccordionContent>
                    {policyType === "official_rules" && s.id === "platform-service-fee-schedule" ? (
                      <PlatformServiceFeeScheduleTable />
                    ) : formatBullets ? (
                      <div className="text-sm leading-relaxed text-white/80">
                        <FormattedLegalSection section={s} formatBullets={formatBullets} />
                      </div>
                    ) : (
                      <div className="prose prose-invert prose-sm max-w-none text-white/60 prose-headings:text-white/80 prose-strong:text-white/80">
                        <ReactMarkdown>{s.content}</ReactMarkdown>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>

            <p className="text-[11px] text-white/20 text-center mt-8">
              ChessBet, Inc. — Version {config?.version}
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
}