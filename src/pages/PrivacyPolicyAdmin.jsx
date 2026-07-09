import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import moment from "moment";

export default function PrivacyPolicyAdmin() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [supportEmail, setSupportEmail] = useState("");
  const [contentMarkdown, setContentMarkdown] = useState("");

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const configs = await base44.entities.PrivacyPolicyConfig.list("-version");
    setHistory(configs);
    const active = configs.find((c) => c.is_active) || configs[0];
    if (active) {
      setSupportEmail(active.support_email);
      setContentMarkdown(active.content_markdown);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    const active = history.find((c) => c.is_active);
    const nextVersion = (active?.version || 0) + 1;

    if (active) {
      await base44.entities.PrivacyPolicyConfig.update(active.id, { is_active: false });
    }
    await base44.entities.PrivacyPolicyConfig.create({
      version: nextVersion,
      last_updated: moment().format("YYYY-MM-DD"),
      support_email: supportEmail,
      content_markdown: contentMarkdown,
      is_active: true,
    });
    await load();
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A]">
        <Loader2 className="animate-spin text-[#C9A84C]" size={28} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] px-5 pt-8 pb-16">
      <Link to="/profile" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 mb-4">
        <ArrowLeft size={14} /> Back to Profile
      </Link>
      <h1 className="text-xl font-extrabold text-white mb-1">Manage Privacy Policy</h1>
      <p className="text-xs text-white/40 mb-6">
        Publishing changes creates a new version. Existing users will be prompted to re-accept.
      </p>

      <div className="space-y-4 max-w-2xl">
        <div>
          <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">Support Email</label>
          <input
            value={supportEmail}
            onChange={(e) => setSupportEmail(e.target.value)}
            className="w-full mt-1.5 h-11 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-white text-sm focus:border-[#C9A84C]/50 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">
            Policy Content (Markdown, use ## for section headings)
          </label>
          <textarea
            value={contentMarkdown}
            onChange={(e) => setContentMarkdown(e.target.value)}
            rows={20}
            className="w-full mt-1.5 p-4 rounded-xl bg-white/[0.05] border border-white/10 text-white text-xs font-mono leading-relaxed focus:border-[#C9A84C]/50 focus:outline-none"
          />
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="h-11 rounded-xl gold-gradient text-black font-bold hover:opacity-90 px-6"
        >
          {saving ? <Loader2 size={14} className="animate-spin mr-2" /> : <Save size={14} className="mr-2" />}
          Publish New Version
        </Button>

        <div className="pt-8">
          <h3 className="text-sm font-semibold text-white/70 mb-3">Version History</h3>
          <div className="space-y-2">
            {history.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/5"
              >
                <div>
                  <p className="text-sm text-white font-semibold">Version {c.version}</p>
                  <p className="text-[11px] text-white/30">{moment(c.last_updated).format("MMMM D, YYYY")}</p>
                </div>
                {c.is_active && (
                  <span className="text-[10px] px-2 py-1 rounded-full bg-[#C9A84C]/10 text-[#C9A84C] font-semibold">
                    Active
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}