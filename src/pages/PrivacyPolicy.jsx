import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2, ArrowLeft, Shield } from "lucide-react";
import { base44 } from "@/api/base44Client";
import moment from "moment";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import ReactMarkdown from "react-markdown";

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

export default function PrivacyPolicy() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openSections, setOpenSections] = useState([]);

  useEffect(() => {
    const load = async () => {
      const configs = await base44.entities.PrivacyPolicyConfig.filter({ is_active: true }, "-version", 1);
      setConfig(configs?.[0] || null);
      setLoading(false);
    };
    load();
  }, []);

  const sections = useMemo(
    () => (config ? parseSections(config.content_markdown, config.support_email) : []),
    [config]
  );

  const scrollToSection = (id) => {
    setOpenSections((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A]">
        <Loader2 className="animate-spin text-[#C9A84C]" size={28} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] pb-16">
      <div className="sticky top-0 z-10 bg-[#0A0A0A]/95 backdrop-blur border-b border-white/5 px-5 py-4">
        <Link to="/profile" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 mb-3">
          <ArrowLeft size={14} /> Back to Profile
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
            <Shield size={18} className="text-[#C9A84C]" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-white">Privacy Policy</h1>
            <p className="text-xs text-white/40">
              Last Updated: {config?.last_updated ? moment(config.last_updated).format("MMMM D, YYYY") : "—"}
            </p>
          </div>
        </div>
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-5 pt-6 max-w-2xl mx-auto">
        {sections.length === 0 ? (
          <p className="text-white/40 text-sm text-center py-10">Privacy Policy content is not yet available.</p>
        ) : (
          <>
            {/* Anchor navigation */}
            <div className="mb-6 rounded-2xl bg-white/[0.03] border border-white/5 p-4">
              <p className="text-[10px] uppercase tracking-widest text-white/30 mb-3">Quick Navigation</p>
              <div className="flex flex-wrap gap-2">
                {sections.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => scrollToSection(s.id)}
                    className="text-xs px-3 py-1.5 rounded-full bg-white/[0.05] text-white/60 hover:bg-[#C9A84C]/10 hover:text-[#C9A84C] transition-colors"
                  >
                    {s.title}
                  </button>
                ))}
              </div>
            </div>

            <Accordion
              type="multiple"
              value={openSections}
              onValueChange={setOpenSections}
              className="space-y-2"
            >
              {sections.map((s) => (
                <AccordionItem
                  key={s.id}
                  value={s.id}
                  id={s.id}
                  className="rounded-2xl bg-white/[0.03] border border-white/5 px-4 scroll-mt-24"
                >
                  <AccordionTrigger className="text-sm font-semibold text-white hover:no-underline">
                    {s.title}
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="prose prose-invert prose-sm max-w-none text-white/60 prose-headings:text-white/80 prose-strong:text-white/80">
                      <ReactMarkdown>{s.content}</ReactMarkdown>
                    </div>
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