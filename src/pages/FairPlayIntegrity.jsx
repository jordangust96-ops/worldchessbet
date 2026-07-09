import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const PROHIBITED = [
  "Using chess engines or move suggestion software during a live game.",
  "Using AI tools to determine moves.",
  "Receiving advice or assistance from another person.",
  "Account sharing.",
  "Creating multiple accounts to gain an unfair advantage.",
  "Match fixing or intentionally losing.",
  "Coordinating results with another player.",
  "Exploiting bugs or attempting to manipulate the platform.",
  "Any software or behavior that provides an unfair competitive advantage.",
];

const CONSEQUENCES = [
  "Match review",
  "Temporary account suspension",
  "Permanent account ban",
  "Match forfeiture",
  "Wager forfeiture where applicable",
  "Additional investigation when necessary",
];

const FAQS = [
  {
    q: "Can I use Stockfish or another chess engine?",
    a: "No.\n\nAny engine assistance during a live ChessBet match is prohibited.",
  },
  {
    q: "Can someone help me during my game?",
    a: "No.\n\nEvery move must be made solely by the player participating in the match.",
  },
  {
    q: "Can I use opening books or databases?",
    a: "No.\n\nExternal chess resources may not be consulted during a live ChessBet game.",
  },
  {
    q: "What if I think my opponent cheated?",
    a: "You will be able to report suspicious behavior after a match.\n\nChessBet reviews reports alongside its own detection systems before taking action.",
  },
  {
    q: "What happens if I disconnect?",
    a: "Temporary connection issues do not automatically result in disciplinary action.\n\nGame outcomes follow the platform's gameplay and timeout rules.",
  },
  {
    q: "Can I appeal a decision?",
    a: "Yes.\n\nPlayers may contact ChessBet Support to request a review of enforcement actions.",
  },
];

function Section({ title, children }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-3">
      <h2 className="text-base font-bold text-white">{title}</h2>
      {children}
    </div>
  );
}

export default function FairPlayIntegrity() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] pb-16">
      <div className="sticky top-0 z-10 bg-[#0A0A0A]/95 backdrop-blur border-b border-white/5 px-5 py-4">
        <Link to="/profile" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 mb-3">
          <ArrowLeft size={14} /> Back to Profile
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
            <ShieldCheck size={18} className="text-[#C9A84C]" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-white">Fair Play & Integrity</h1>
          </div>
        </div>
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-5 pt-6 max-w-2xl mx-auto space-y-4">
        <p className="text-sm text-white/50 leading-relaxed">
          ChessBet is built on fair, skill-based competition. Every player deserves a level playing field, and
          protecting the integrity of every match is one of our highest priorities.
        </p>

        <Section title="Our Commitment to Fair Play">
          <p className="text-sm text-white/60 leading-relaxed">
            ChessBet is a skill-based competition platform where players compete for real money. Every move should
            reflect the player's own decisions and ability.
          </p>
          <p className="text-sm text-white/60 leading-relaxed">
            We are committed to providing an environment that is competitive, transparent, and fair for everyone.
          </p>
          <p className="text-sm text-white/60 leading-relaxed">
            Protecting fair play protects every player and every wager.
          </p>
        </Section>

        <Section title="What Is Not Allowed">
          <p className="text-sm text-white/60">Prohibited activities include:</p>
          <ul className="space-y-2">
            {PROHIBITED.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-white/60">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#C9A84C]/60 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
          <p className="text-sm font-semibold text-[#C9A84C] pt-1">Every move you make must be your own.</p>
        </Section>

        <Section title="How We Protect Fair Play">
          <p className="text-sm text-white/60 leading-relaxed">
            ChessBet uses a combination of automated systems, gameplay analysis, server-side validation, and ongoing
            monitoring to help identify suspicious behavior.
          </p>
          <p className="text-sm text-white/60 leading-relaxed">
            To protect the effectiveness of these systems, we do not publicly disclose the specific methods used to
            detect unfair play.
          </p>
          <p className="text-sm text-white/60 leading-relaxed">
            Our goal is to maintain a competitive environment that honest players can trust.
          </p>
        </Section>

        <Section title="What Happens If Fair Play Rules Are Violated">
          <ul className="space-y-2">
            {CONSEQUENCES.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-white/60">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#C9A84C]/60 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
          <p className="text-sm text-white/50 pt-1">
            Every reported or detected incident is reviewed before permanent action is taken.
          </p>
        </Section>

        <div className="rounded-2xl bg-white/[0.03] border border-white/5 px-4">
          <p className="text-xs font-semibold text-white/50 uppercase tracking-wider px-1 pt-4 pb-1">
            Frequently Asked Questions
          </p>
          <Accordion type="multiple" className="space-y-1">
            {FAQS.map((item) => (
              <AccordionItem key={item.q} value={item.q} className="border-white/5">
                <AccordionTrigger className="text-sm font-semibold text-white hover:no-underline">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent>
                  <div className="text-sm text-white/60 whitespace-pre-line leading-relaxed">{item.a}</div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        <div className="rounded-2xl bg-[#C9A84C]/5 border border-[#C9A84C]/20 p-5 space-y-2">
          <p className="text-sm font-bold text-[#C9A84C]">Integrity First</p>
          <p className="text-sm text-white/60 leading-relaxed">
            ChessBet exists because players trust that every match is decided by skill.
          </p>
          <p className="text-sm text-white/60 leading-relaxed">
            We continuously improve our systems to protect honest players while keeping the platform competitive,
            transparent, and enjoyable for everyone.
          </p>
        </div>
      </motion.div>
    </div>
  );
}