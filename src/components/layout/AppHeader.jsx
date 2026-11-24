import React from "react";
import { Link } from "react-router-dom";
import AccountBalance from "@/components/layout/AccountBalance";
import Logo from "@/components/Logo";

export default function AppHeader() {
  return (
    <header className="flex min-h-[88px] shrink-0 items-center justify-between gap-4 bg-background px-5 py-4">
      <Link to="/play" aria-label="ChessBet home"><Logo size="sm" /></Link>
      <AccountBalance />
    </header>
  );
}
