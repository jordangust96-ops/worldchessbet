import React, { useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { REPORT_CATEGORIES } from "@/lib/disputeCaseLabels";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Auto-attaches everything the platform already knows about the contest
// (players, wager, time control, move history, outcome, ledger references)
// server-side in submitContestReport — the user only describes the concern.
export default function ReportContestModal({ open, onOpenChange, matchId, gameId }) {
  const [category, setCategory] = useState("fair_play");
  const [subcategory, setSubcategory] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [caseNumber, setCaseNumber] = useState(null);

  const resetAndClose = () => {
    setCategory("fair_play");
    setSubcategory("");
    setDescription("");
    setCaseNumber(null);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!description.trim()) return;
    setSubmitting(true);
    try {
      const { data } = await base44.functions.invoke("submitContestReport", {
        matchId,
        gameId,
        category,
        subcategory,
        description,
      });
      setCaseNumber(data?.caseNumber);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : resetAndClose())}>
      <DialogContent className="max-w-md">
        {caseNumber ? (
          <div className="text-center py-4 space-y-3">
            <CheckCircle2 size={40} className="text-[#C9A84C] mx-auto" />
            <p className="text-white font-bold">Your report has been received and assigned Case #{caseNumber}.</p>
            <p className="text-xs text-white/50">
              Our team will review the information and contact you if additional details are required.
            </p>
            <Button onClick={resetAndClose} className="w-full h-11 rounded-xl gold-gradient text-black font-bold hover:opacity-90">
              Done
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Report Contest</DialogTitle>
              <DialogDescription>
                Your report creates an internal case for our team to review. It does not change this contest's
                outcome or any balances.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">Category</label>
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setSubcategory("");
                  }}
                  className="w-full h-10 px-3 rounded-xl bg-white/[0.05] border border-white/10 text-white text-sm focus:border-[#C9A84C]/50 focus:outline-none"
                >
                  {Object.entries(REPORT_CATEGORIES).map(([value, cfg]) => (
                    <option key={value} value={value} className="bg-[#111]">
                      {cfg.label}
                    </option>
                  ))}
                </select>
              </div>

              {REPORT_CATEGORIES[category].subcategories.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">
                    Subcategory (optional)
                  </label>
                  <select
                    value={subcategory}
                    onChange={(e) => setSubcategory(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-white/[0.05] border border-white/10 text-white text-sm focus:border-[#C9A84C]/50 focus:outline-none"
                  >
                    <option value="" className="bg-[#111]">
                      Select a subcategory...
                    </option>
                    {REPORT_CATEGORIES[category].subcategories.map((s) => (
                      <option key={s} value={s} className="bg-[#111]">
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="Describe what happened..."
                  className="w-full p-3 rounded-xl bg-white/[0.05] border border-white/10 text-white text-sm placeholder:text-white/20 focus:border-[#C9A84C]/50 focus:outline-none"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={resetAndClose} className="border-white/10" disabled={submitting}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting || !description.trim()}
                className="gold-gradient text-black hover:opacity-90 font-semibold"
              >
                {submitting && <Loader2 size={14} className="animate-spin mr-1.5" />}
                Submit Report
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}