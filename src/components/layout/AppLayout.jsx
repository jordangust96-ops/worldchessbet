import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import BottomNav from "./BottomNav";

const HIDE_NAV_PATHS = ["/landing", "/login", "/register", "/forgot-password", "/reset-password"];

export default function AppLayout() {
  const location = useLocation();
  const hideNav = HIDE_NAV_PATHS.some(p => location.pathname.startsWith(p));

  return (
    <div className="min-h-screen bg-background">
      <main className={hideNav ? "" : "pb-24"}>
        <Outlet />
      </main>
      {!hideNav && <BottomNav />}
    </div>
  );
}