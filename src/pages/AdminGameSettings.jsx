import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, WifiOff, Save } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

// Admin-only control for the reconnect grace period shown to players during a
// disconnect. This value is informational/display-only for now \u2014 the chess
// clock remains the sole authority over any timeout outcome.
export default function AdminGameSettings() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsId, setSettingsId] = useState(null);
  const [graceSeconds, setGraceSeconds] = useState(45);
  const { toast } = useToast();

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const me = await base44.auth.me();
    if (me?.role !== "admin") {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    setIsAdmin(true);

    const rows = await base44.entities.GameSettings.list();
    if (rows[0]) {
      setSettingsId(rows[0].id);
      setGraceSeconds(rows[0].reconnect_grace_period_seconds ?? 45);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const value = Math.max(5, Math.round(Number(graceSeconds) || 45));
      if (settingsId) {
        await base44.entities.GameSettings.update(settingsId, { reconnect_grace_period_seconds: value });
      } else {
        const created = await base44.entities.GameSettings.create({ reconnect_grace_period_seconds: value });
        setSettingsId(created.id);
      }
      setGraceSeconds(value);
      toast({ title: "Saved", description: "Reconnect grace period updated." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A]">
        <Loader2 className="animate-spin text-[#C9A84C]" size={28} />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0A0A0A] px-5 text-center">
        <p className="text-white font-semibold mb-2">Access Restricted</p>
        <p className="text-white/40 text-sm mb-4">You don't have permission to view this page.</p>
        <Link to="/profile" className="text-xs text-[#C9A84C] hover:underline">
          Back to Profile
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] px-5 pt-8 pb-16 max-w-2xl mx-auto">
      <Link to="/profile" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 mb-4">
        <ArrowLeft size={14} /> Back to Profile
      </Link>

      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
          <WifiOff size={18} className="text-[#C9A84C]" />
        </div>
        <h1 className="text-xl font-extrabold text-white">Disconnect & Reconnect Settings</h1>
      </div>
      <p className="text-xs text-white/40 mb-6">
        Controls the reconnect grace period shown to players during a disconnect. The chess clock always remains the
        sole authority over any timeout outcome \u2014 this setting never grants extra thinking time or triggers a
        forfeiture on its own.
      </p>

      <div className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="grace-seconds" className="text-xs text-white/50">
            Reconnect grace period (seconds)
          </Label>
          <Input
            id="grace-seconds"
            type="number"
            min={5}
            max={600}
            value={graceSeconds}
            onChange={(e) => setGraceSeconds(e.target.value)}
            className="bg-white/[0.03] border-white/10 text-white max-w-[160px]"
          />
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="gold-gradient text-black hover:opacity-90 font-semibold"
        >
          <Save className="w-4 h-4 mr-1.5" />
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}