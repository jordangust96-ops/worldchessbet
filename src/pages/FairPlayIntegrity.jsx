import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import {
  PROHIBITED_CATEGORIES,
  MONITORING_SOURCES,
  RISK_INDICATORS,
  INVESTIGATION_ACTIONS,
  ENFORCEMENT_ACTIONS,
  PRIVATE_CHALLENGE_REVIEW_ITEMS,
  REPORTING_ITEMS,
} from "@/lib/fairPlayPolicyContent";

function Section({ title, children }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-3">
      <h2 className="text-base font-bold text-white">{title}</h2>
      {children}
    </div>
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
            <h1 className="text-xl font-extrabold text-white">Fair Play & Integrity Policy</h1>
          </div>
        </div>
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-5 pt-6 max-w-2xl mx-auto space-y-4">
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

        {/* 3. Prohibited Conduct */}
        <Section title="3. Prohibited Conduct">
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

        {/* 4. Integrity Monitoring */}
        <Section title="4. Integrity Monitoring">
          <p className="text-sm text-white/60 leading-relaxed">
            ChessBet uses a combination of automated checks and manual review as part of its integrity
            program.
          </p>
          <p className="text-sm text-white/60">
            When investigating suspected violations, ChessBet may review sources that include:
          </p>
          <BulletList items={MONITORING_SOURCES} />
          <p className="text-xs text-white/40 pt-1">
            These sources are reviewed as part of an investigation into suspected violations — not as a
            claim that every source is continuously monitored for every account.
          </p>
        </Section>

        {/* 5. Risk Flagging */}
        <Section title="5. Risk Flagging">
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

        {/* 6. Investigations */}
        <Section title="6. Investigations">
          <p className="text-sm text-white/60 leading-relaxed">
            When ChessBet opens an investigation into suspected violations of this policy, it may:
          </p>
          <BulletList items={INVESTIGATION_ACTIONS} />
          <p className="text-xs text-white/40 pt-1">
            Investigations vary in scope and complexity, and ChessBet does not commit to a fixed
            investigation timeline.
          </p>
        </Section>

        {/* 7. Possible Enforcement */}
        <Section title="7. Possible Enforcement">
          <p className="text-sm text-white/60 leading-relaxed">
            Violations of this policy may result in one or more of the following, at ChessBet's
            discretion and proportionate to the conduct involved:
          </p>
          <BulletList items={ENFORCEMENT_ACTIONS} />
        </Section>

        {/* 8. Appeals */}
        <Section title="8. Appeals">
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

        {/* 9. Private Challenges */}
        <Section title="9. Private Challenges">
          <p className="text-sm text-white/60 leading-relaxed">
            Private contests receive the same integrity protections as public contests. To help prevent
            collusion and financial abuse, ChessBet may review:
          </p>
          <BulletList items={PRIVATE_CHALLENGE_REVIEW_ITEMS} />
        </Section>

        {/* 10. Reporting Fair Play Concerns */}
        <Section title="10. Reporting Fair Play Concerns">
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

        {/* 11. Future Improvements */}
        <Section title="11. Future Improvements">
          <p className="text-sm text-white/60 leading-relaxed">
            ChessBet continually improves its integrity program as the platform evolves. Future
            improvements may include additional fraud detection, anti-cheating technology, and enhanced
            monitoring capabilities.
          </p>
          <p className="text-xs text-white/40">
            This section describes planned direction, not capabilities that are currently in place.
          </p>
        </Section>

        {/* 12. Cross References */}
        <Section title="12. Cross References">
          <p className="text-sm text-white/60 leading-relaxed">
            This policy should be read together with ChessBet's Official Rules, Terms of Service,
            AML/KYC Policy, and{" "}
            <Link to="/privacy-policy" className="text-[#C9A84C] hover:underline underline-offset-2">
              Privacy Policy
            </Link>
            .
          </p>
        </Section>

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