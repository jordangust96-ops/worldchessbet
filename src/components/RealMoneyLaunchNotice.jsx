import React, { useState } from "react";
import { Sparkles } from "lucide-react";
import NotifyAtLaunchModal from "@/components/NotifyAtLaunchModal";

// Pre-launch notice shown while real-money play is still being finished.
// Self-contained: owns its own "Notify me" modal state, so any page can drop
// it in with no extra wiring. Remove once ChessBet has officially launched
// real-money contests (this component and NotifyAtLaunchModal both).
export default function RealMoneyLaunchNotice() {
  const [notifyModalOpen, setNotifyModalOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-[#C9A84C]/20 bg-[#C9A84C]/[0.05] p-4 flex items-start gap-3">
      <div className="h-9 w-9 rounded-lg bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
        <Sparkles size={18} className="text-[#C9A84C]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white">Real-money play is almost here</p>
        <p className="text-xs text-white/50 mt-1">
          We're putting the finishing touches on real-money contests, and they'll be open soon.{" "}
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
