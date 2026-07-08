import React from "react";
import { Crown } from "lucide-react";

export default function AuthLayout({ icon: Icon, title, subtitle, footer, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-2 mb-6">
            <Crown className="text-[#C9A84C]" size={22} />
            <span className="text-base font-bold tracking-tight text-white">
              Chess<span className="text-[#C9A84C]">Bet</span>
            </span>
          </div>
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl gold-gradient mb-4">
            <Icon className="w-7 h-7 text-black" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">{title}</h1>
          {subtitle && <p className="text-white/50 mt-2">{subtitle}</p>}
        </div>
        <div className="bg-[#141414] rounded-2xl border border-white/5 p-8">
          {children}
        </div>
        {footer && (
          <p className="text-center text-sm text-white/40 mt-6">{footer}</p>
        )}
      </div>
    </div>
  );
}