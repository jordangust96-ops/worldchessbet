import React, { useState } from "react";
import { Info } from "lucide-react";
import { DEMO_MODE } from "@/lib/appConfig";
import NotifyAtLaunchModal from "@/components/NotifyAtLaunchModal";

export default function DemoModeNotice() {
  const [modalOpen, setModalOpen] = useState(false);

  if (!DEMO_MODE) return null;

  return (
    <>
      <p className="flex items-center gap-1 text-[10px] text-white/35 mb-4">
        <Info size={10} strokeWidth={2} className="shrink-0 text-[#C9A84C]/50" />
        <span>
          Early Access: ChessBet is currently in early access. Real-money wagering will be
          available soon. Deposits, withdrawals, and wager settlements are not yet active.{" "}
          <button
            onClick={() => setModalOpen(true)}
            className="text-[#C9A84C] font-semibold underline underline-offset-2 hover:text-[#E8D48B]"
          >
            Notify me at launch
          </button>
        </span>
      </p>
      <NotifyAtLaunchModal open={modalOpen} onOpenChange={setModalOpen} />
    </>
  );
}