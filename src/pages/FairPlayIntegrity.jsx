import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
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
  PROHIBITED_CATEGORIES,
  MONITORING_SOURCES,
  RISK_INDICATORS,
  INVESTIGATION_ACTIONS,
  ENFORCEMENT_ACTIONS,
  PRIVATE_CHALLENGE_REVIEW_ITEMS,
  REPORTING_ITEMS,
} from "@/lib/fairPlayPolicyContent";

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function Section({ id, title, children }) {
  const sectionId = id || slugify(title);

  return (
    <AccordionItem
      value={sectionId}
      id={sectionId}
      className="rounded-2xl bg-white/[0.03] border border-white/5 px-5 scroll-mt-28"
    >
      <AccordionTrigger className="text-left text-base font-bold text-white hover:no-underline">
        {title}
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-3 pb-1">{children}</div>
      </AccordionContent>
    </AccordionItem>
  );
}

function BulletList({ items }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5 text-sm text-white/60">
          <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#C9A84C]/60 shrink-0" />
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function FairPlayIntegrity() {
  const { hash } = useLocation();
  const [openSections, setOpenSections] = useState([]);

  useEffect(() => {
    if (!hash) return undefined;

    const rawId = hash.slice(1);
    let targetId = rawId;
    try {
      targetId = decodeURIComponent(rawId);
    } catch {
      // Keep the raw hash when it is not valid encoded text.
    }

    setOpenSections((current) =>
      current.includes(targetId) ? current : [...current, targetId]
    );

    const timer = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 120);

    return () => window.clearTimeout(timer);
  }, [hash]);

  return (
    <div className="min-h-screen bg-[#0A0A0A] pb-16">
      <SEO
        title="Chess Anti-Cheat & Human Fair-Play Review | ChessBet"
        description="See how ChessBet protects cash-prize chess with server-verified games, Stockfish screening, player reports, evidence review, disputes, and appeals."
        canonicalUrl={`${SITE_URL}/fair-play-integrity`}
        structuredData={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "ChessBet Fair Play & Integrity",
          description: "ChessBet's integrity controls, human review process, reporting, disputes, and appeals for skill-based chess contests.",
          url: `${SITE_URL}/fair-play-integrity`,
        }}
      />
      <div className="sticky top-0 z-10 bg-[#0A0A0A]/95 backdrop-blur border-b border-white/5 px-5 py-4">
        <Link to="/profile" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 mb-3">
          <ArrowLeft size={14} /> Back to Profile
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
            <ShieldCheck size={18} className="text-[#C9A84C]" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-white">Fair Play & Integrity Policy</h1>
          </div>
        </div>
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-5 pt-6 max-w-2xl mx-auto space-y-4">
        <Accordion
          type="multiple"
          value={openSections}
          onValueChange={setOpenSections}
          className="space-y-3"
        >
          <Section id="fair-play-and-appeals" title="Quick answer: How fair play and appeals work">
          <p className="text-sm text-white/60 leading-relaxed">
            ChessBet validates moves, clocks, game state, and results on its servers. Completed contests
            may then be screened with Stockfish and behavioral checks. Player reports can also supply
            evidence for review.
          </p>
          <p className="text-sm text-white/60 leading-relaxed">
            Automated signals never impose a penalty or change a result by themselves. A person reviews
            the available game, technical, report, and account evidence before deciding. A user affected
            by an enforcement decision may contact ChessBet Support, provide additional information, and
            request reconsideration.
          </p>
        </Section>

        {/* 1. Purpose */}
        <Section title="1. Purpose">
          <p className="text-sm text-white/60 leading-relaxed">
            ChessBet is a peer-to-peer skill competition platform. Every contest on ChessBet should be
            decided solely by the participating players' chess skill.
          </p>
          <p className="text-sm text-white/60 leading-relaxed">
            Protecting competitive integrity is essential — for the players who compete on ChessBet, for
            the payment partners who support the platform, and for the regulators who oversee it.
          </p>
          <p className="text-sm text-white/60 leading-relaxed">
            This Fair Play & Integrity Policy supplements ChessBet's Official Rules and Terms of Service.
            Where this policy references conduct, review procedures, or enforcement, it should be read
            together with those documents.
          </p>
        </Section>

        {/* 2. Core Principles */}
        <Section title="2. Core Principles">
          <p className="text-sm text-white/60">ChessBet is committed to:</p>
          <BulletList
            items={[
              "Fair competition",
              "Honest gameplay",
              "Financial integrity",
              "Player safety",
              "Fraud prevention",
              "Regulatory compliance",
            ]}
          />
        </Section>

        <Section title="3. Contest Fee Integrity">
          <p className="text-sm text-white/60 leading-relaxed">
            Each contest separately states the Contest Entry Amount and the fixed-dollar Platform Service Fee for each player before commitment.
          </p>
          <p className="text-sm text-white/60 leading-relaxed">
            The Platform Service Fee is not a percentage of stakes, is not part of the contest pool, and is not deducted from the Potential Winner Award. The winner of a decisive contest receives 100% of the combined Contest Entry Amounts.
          </p>
          <p className="text-sm text-white/60 leading-relaxed">
            ChessBet records the Contest Entry Amount and Platform Service Fee in separate ledger and settlement entries. The Platform Service Fee is refunded or not collected if there is no decisive result, including a draw, cancellation, or platform void.
          </p>
        </Section>

        {/* 4. Prohibited Conduct */}
        <Section title="4. Prohibited Conduct">
          <p className="text-sm text-white/60">
            The following categories of conduct are prohibited on ChessBet. This list is illustrative and
            not exhaustive — ChessBet may take action against other conduct that undermines fair
            competition, financial integrity, or platform security.
          </p>
          <div className="space-y-4 pt-1">
            {PROHIBITED_CATEGORIES.map((category) => (
              <div key={category.title} className="space-y-2">
                <p className="text-xs font-semibold text-[#C9A84C]/80 uppercase tracking-widest">
                  {category.title}
                </p>
                <BulletList items={category.items} />
              </div>
            ))}
          </div>
          <p className="text-sm font-semibold text-[#C9A84C] pt-1">Every move you make must be your own.</p>
        </Section>

        {/* 5. Integrity Monitoring */}
        <Section id="how-cheating-is-caught" title="5. Integrity Monitoring">
          <p className="text-sm text-white/60 leading-relaxed">
            ChessBet combines server-authoritative gameplay controls, automated post-game screening,
            rule-based behavioral checks, player reporting, and manual administrative review.
          </p>
          <p className="text-sm text-white/60 leading-relaxed">
            Legal moves, game state, results, and chess clocks are validated and recorded by ChessBet's
            servers. After settlement, completed contests are queued for Stockfish-powered screening.
            Depending on the available game data, that screening may evaluate engine move agreement,
            centipawn loss, critical-position performance, move timing, and focus-loss events.
          </p>
          <p className="text-sm text-white/60">
            When investigating suspected violations, ChessBet may review sources that include:
          </p>
          <BulletList items={MONITORING_SOURCES} />
          <p className="text-sm text-white/60 leading-relaxed pt-1">
            Automated results and rule-based flags are indicators for confidential human review. They do
            not, standing alone, establish wrongdoing or impose an automatic penalty.
          </p>
        </Section>

        {/* 6. Risk Flagging */}
        <Section title="6. Risk Flagging">
          <p className="text-sm text-white/60 leading-relaxed">
            ChessBet may use internal risk indicators to help identify activity that warrants a closer
            look. Examples include:
          </p>
          <BulletList items={RISK_INDICATORS} />
          <p className="text-sm text-white/60 leading-relaxed pt-1">
            An internal risk flag does not, by itself, establish wrongdoing. A flag simply initiates
            additional review — it is not a finding or a penalty.
          </p>
        </Section>

        {/* 7. Investigations */}
        <Section title="7. Investigations">
          <p className="text-sm text-white/60 leading-relaxed">
            When ChessBet opens an investigation into suspected violations of this policy, it may:
          </p>
          <BulletList items={INVESTIGATION_ACTIONS} />
          <p className="text-xs text-white/40 pt-1">
            Investigations vary in scope and complexity, and ChessBet does not commit to a fixed
            investigation timeline.
          </p>
        </Section>

        {/* 8. Possible Enforcement */}
        <Section title="8. Possible Enforcement">
          <p className="text-sm text-white/60 leading-relaxed">
            Violations of this policy may result in one or more of the following, at ChessBet's
            discretion and proportionate to the conduct involved:
          </p>
          <BulletList items={ENFORCEMENT_ACTIONS} />
        </Section>

        {/* 9. Appeals */}
        <Section id="appeals" title="9. Appeals">
          <p className="text-sm text-white/60 leading-relaxed">
            A user subject to an enforcement decision may:
          </p>
          <BulletList
            items={["Contact ChessBet Support", "Submit additional information", "Request reconsideration of the decision"]}
          />
          <p className="text-sm text-white/60 leading-relaxed pt-1">
            When an appeal is submitted, ChessBet reviews game records, technical records, payment
            records, and other available evidence relevant to the decision.
          </p>
          <p className="text-sm text-white/60 leading-relaxed">
            Final decisions are made after review of all available information.
          </p>
        </Section>

        {/* 10. Private Challenges */}
        <Section title="10. Private Challenges">
          <p className="text-sm text-white/60 leading-relaxed">
            Private contests receive the same integrity protections as public contests. To help prevent
            collusion and financial abuse, ChessBet may review:
          </p>
          <BulletList items={PRIVATE_CHALLENGE_REVIEW_ITEMS} />
        </Section>

        {/* 11. Reporting Fair Play Concerns */}
        <Section title="11. Reporting Fair Play Concerns">
          <p className="text-sm text-white/60 leading-relaxed">
            Players are encouraged to report the following to ChessBet Support rather than raising them
            publicly:
          </p>
          <BulletList items={REPORTING_ITEMS} />
          <p className="text-sm text-white/60 leading-relaxed pt-1">
            Please do not make public accusations against other players. Report concerns directly to
            ChessBet Support so they can be reviewed fairly and confidentially.
          </p>
        </Section>

        {/* 12. Ongoing Integrity Program */}
        <Section title="12. Ongoing Integrity Program">
          <p className="text-sm text-white/60 leading-relaxed">
            ChessBet maintains and continuously evaluates its fair-play safeguards, screening thresholds,
            review procedures, and audit records. Integrity controls may be refined as new evidence,
            detection methods, and security practices become available.
          </p>
          <p className="text-sm text-white/60 leading-relaxed">
            Changes to detection methods do not alter the requirement for a fair, evidence-based review
            before an enforcement decision is made.
          </p>
        </Section>

        {/* 13. Cross References */}
        <Section title="13. Cross References">
          <p className="text-sm text-white/60 leading-relaxed">
            This policy should be read together with ChessBet's Official Rules, Terms of Service,
            AML/KYC Policy, and{" "}
            <Link to="/privacy-policy" className="text-[#C9A84C] hover:underline underline-offset-2">
              Privacy Policy
            </Link>
            .
          </p>
          </Section>
        </Accordion>

        <div className="rounded-2xl bg-[#C9A84C]/5 border border-[#C9A84C]/20 p-5 space-y-2">
          <p className="text-sm font-bold text-[#C9A84C]">Integrity First</p>
          <p className="text-sm text-white/60 leading-relaxed">
            ChessBet exists because players trust that every match is decided by skill.
          </p>
          <p className="text-sm text-white/60 leading-relaxed">
            We continuously improve our systems to protect honest players while keeping the platform
            competitive, transparent, and enjoyable for everyone.
          </p>
        </div>
      </motion.div>
    </div>
  );
}