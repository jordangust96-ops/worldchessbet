import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import moment from "moment";
import { LEGAL_DOCUMENT_TYPES } from "@/lib/legalDocumentTypes";

export default function AcceptPolicyPrompt({ config, policyType, onAccepted }) {
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const docMeta = LEGAL_DOCUMENT_TYPES[policyType];

  const handleAccept = async () => {
    setSubmitting(true);
    const me = await base44.auth.me();
    await base44.entities.PrivacyPolicyAcceptance.create({
      user_id: me.id,
      policy_type: policyType,
      policy_version: config.version,
      accepted_at: new Date().toISOString(),
    });
    setSubmitting(false);
    onAccepted();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A0A0A] px-5">
      <div className="w-full max-w-sm rounded-3xl bg-[#111] border border-white/10 p-6 space-y-5">
        <div className="w-12 h-12 rounded-2xl bg-[#C9A84C]/10 flex items-center justify-center">
          <ShieldCheck size={22} className="text-[#C9A84C]" />
        </div>
        <div>
          <h2 className="text-lg font-extrabold text-white">Updated {docMeta.label}</h2>
          <p className="text-sm text-white/40 mt-1">
            We've updated our {docMeta.label} (Version {config.version}, {moment(config.last_updated).format("MMMM D, YYYY")}).
            Please review and accept it to continue using ChessBet.
          </p>
        </div>

        <Link
          to={docMeta.route}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-[#C9A84C] hover:underline"
        >
          Read the {docMeta.label} <ExternalLink size={13} />
        </Link>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded accent-[#C9A84C]"
          />
          <span className="text-sm text-white/70">
            I have read and agree to the updated {docMeta.label}.
          </span>
        </label>

        <Button
          onClick={handleAccept}
          disabled={!checked || submitting}
          className="w-full h-12 rounded-2xl gold-gradient text-black font-bold hover:opacity-90 disabled:opacity-30"
        >
          {submitting ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
          Agree & Continue
        </Button>
      </div>
    </div>
  );
}