import React from "react";
import { Crown } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

// Deliberately subtle — just a small gold-ringed icon. The "Founding Player"
// label only appears on hover/tap, so it never competes with the username.
export default function FoundingPlayerBadge() {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white/[0.06] border border-white/10 cursor-default">
            <Crown size={11} className="text-[#C9A84C]" />
          </span>
        </TooltipTrigger>
        <TooltipContent>Founding Player</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}