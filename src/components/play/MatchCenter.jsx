import React from "react";
import AvailableMatchSection from "@/components/play/AvailableMatchSection";
import HostMatchSection from "@/components/play/HostMatchSection";

export default function MatchCenter({ userId, balance }) {
  return (
    <div className="rounded-3xl bg-gradient-to-br from-[#1A1A1A] to-[#111] border border-white/5 p-6">
      <AvailableMatchSection userId={userId} />
      <div className="h-px bg-white/[0.06] my-6" />
      <HostMatchSection userId={userId} balance={balance} />
    </div>
  );
}