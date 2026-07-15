import React, { useState } from "react";
import { Flag, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { base44 } from "@/api/base44Client";
import { REPORT_CATEGORIES } from "@/lib/reportCategories";

// Entry point for the Contest Reporting framework — easily accessible but
// unobtrusive. The platform already knows the contest, players, and outcome,
// so the user only ever picks a category and describes their concern.
export default function ReportContestDialog({ matchId, gameId, triggerClassName }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const subcategoryOptions = category ? REPORT_CATEGORIES[category]?.subcategories || [] : [];

  const resetForm = () => {
    setCategory("");
    setSubcategory("");
    setDescription("");
  };

  const handleSubmit = async () => {
    if (!category || !description.trim()) return;
    setSubmitting(true);
    try {
      const { data } = await base44.functions.invoke("submitContestReport", {
        matchId,
        gameId,
        category,
        subcategory,
        description,
      });
      setOpen(false);
      resetForm();
      toast({
        title: `Report received — Case #${data.case_number}`,
        description: "Our team will review the information and contact you if additional details are required.",
      });
    } catch (error) {
      toast({
        title: "Couldn't submit report",
        description: error?.response?.data?.error || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className={
            triggerClassName ||
            "inline-flex items-center gap-1 text-[11px] text-white/30 hover:text-white/60 transition-colors"
          }
        >
          <Flag size={11} />
          Report Contest
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report Contest</DialogTitle>
          <DialogDescription>
            Let us know about a concern with this match. Our compliance team will review it — this will not change
            the contest outcome automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-white/50">Category</Label>
            <Select
              value={category}
              onValueChange={(v) => {
                setCategory(v);
                setSubcategory("");
              }}
            >
              <SelectTrigger className="bg-white/[0.03] border-white/10 text-white">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(REPORT_CATEGORIES).map(([key, { label }]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {subcategoryOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-white/50">Subcategory (optional)</Label>
              <Select value={subcategory} onValueChange={setSubcategory}>
                <SelectTrigger className="bg-white/[0.03] border-white/10 text-white">
                  <SelectValue placeholder="Select a subcategory" />
                </SelectTrigger>
                <SelectContent>
                  {subcategoryOptions.map((sub) => (
                    <SelectItem key={sub} value={sub}>
                      {sub}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-white/50">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what happened..."
              className="bg-white/[0.03] border-white/10 text-white min-h-[100px]"
              maxLength={4000}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="border-white/10" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !category || !description.trim()}
            className="gold-gradient text-black font-semibold hover:opacity-90"
          >
            {submitting ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
            Submit Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}