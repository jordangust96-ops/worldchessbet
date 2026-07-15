import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { FLAG_TYPE_LABELS } from "@/lib/integrityLabels";

export default function NewIntegrityFlagForm({ userId, onCreated }) {
  const [flagType, setFlagType] = useState("manual");
  const [severity, setSeverity] = useState("low");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    setSaving(true);
    try {
      await base44.functions.invoke("createIntegrityFlag", { userId, flagType, severity, notes });
      setNotes("");
      onCreated?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-4 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <select
          value={flagType}
          onChange={(e) => setFlagType(e.target.value)}
          className="h-10 px-3 rounded-xl bg-white/[0.05] border border-white/10 text-white text-xs focus:border-[#C9A84C]/50 focus:outline-none"
        >
          {Object.entries(FLAG_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value} className="bg-[#111]">
              {label}
            </option>
          ))}
        </select>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="h-10 px-3 rounded-xl bg-white/[0.05] border border-white/10 text-white text-xs focus:border-[#C9A84C]/50 focus:outline-none"
        >
          <option value="low" className="bg-[#111]">Low Severity</option>
          <option value="medium" className="bg-[#111]">Medium Severity</option>
          <option value="high" className="bg-[#111]">High Severity</option>
        </select>
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Describe the concern..."
        rows={2}
        className="w-full p-3 rounded-xl bg-white/[0.05] border border-white/10 text-white text-xs placeholder:text-white/20 focus:border-[#C9A84C]/50 focus:outline-none"
      />
      <Button
        size="sm"
        disabled={saving}
        onClick={handleCreate}
        className="h-9 rounded-lg text-xs gold-gradient text-black font-bold hover:opacity-90"
      >
        {saving && <Loader2 size={12} className="animate-spin mr-1" />}
        Create Flag
      </Button>
    </div>
  );
}