import React from "react";
import { Crown } from "lucide-react";
import Logo from "@/components/Logo";

export default function AuthLayout({ icon: Icon, title, subtitle = "", footer = null, children = null, minimal = false }) {
  return (
    <div className={minimal ? "flex min-h-[calc(100svh-var(--app-safe-top))] items-center justify-center bg-[#0A0A0A] px-7 pb-[max(24px,var(--app-safe-bottom))] pt-6" : "min-h-screen flex items-center justify-center bg-[#0A0A0A] px-4 py-14"}>
      <div className="w-full max-w-md">
        <div className={minimal ? "text-center mb-6" : "text-center mb-10"}>
          {minimal ? <Logo size="lg" className="justify-center mb-5" /> : <>
          <div className="flex items-center justify-center gap-2 mb-6">
            <Crown className="text-[#C9A84C]" strokeWidth={1.5} size={22} />
            <span className="text-base font-bold tracking-tight gold-text">
              ChessBet
            </span>
          </div>
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl gold-gradient mb-4">
            <Icon className="w-7 h-7 text-black" aria-hidden="true" />
          </div>
          </>}
          <h1 className={minimal ? "text-xl font-semibold tracking-tight text-white" : "text-3xl font-bold tracking-tight text-white"}>{title}</h1>
          {subtitle && <p className="text-white/50 mt-2">{subtitle}</p>}
        </div>
        <div className={minimal ? "" : "bg-[#141414] rounded-2xl border border-white/5 p-8"}>
          {children}
        </div>
        {footer && (
          <div className="text-center text-sm text-white/40 mt-6">{footer}</div>
        )}
      </div>
    </div>
  );
}