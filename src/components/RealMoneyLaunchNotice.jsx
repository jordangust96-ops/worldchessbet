import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Sparkles } from "lucide-react";
import NotifyAtLaunchModal from "@/components/NotifyAtLaunchModal";

// Pre-launch notice shown while real-money play is still being finished.
// Server availability controls visibility. A failed status request keeps the
// notice visible; it never grants access to paid contests.
export default function RealMoneyLaunchNotice() {
  const [notifyModalOpen, setNotifyModalOpen] = useState(false);

  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    base44.functions.invoke("getLaunchAvailability", {}).then(({ data }) => {
      if (!cancelled) setAvailable(data?.paid_contests_enabled === true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  if (available) return null;

  return (
    <div className="rounded-2xl border border-[#C9A84C]/20 bg-[#C9A84C]/[0.05] p-4 flex items-start gap-3">
      <div className="h-9 w-9 rounded-lg bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
        <Sparkles size={18} className="text-[#C9A84C]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white">Real-money play is almost here</p>
        <p className="text-xs text-white/50 mt-1">
          Real-money contests are not open yet. We're completing the final steps before launch.{" "}
          <button
            type="button"
            onClick={() => setNotifyModalOpen(true)}
            className="text-[#C9A84C] underline underline-offset-2 hover:text-[#E2C66E]"
          >
            Click here to be notified the moment it launches.
          </button>
        </p>
      </div>
      <NotifyAtLaunchModal open={notifyModalOpen} onOpenChange={setNotifyModalOpen} />
    </div>
  );
}
