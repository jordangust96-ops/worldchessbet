import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import BottomNav from "./BottomNav";
import DemoModeNotice from "@/components/DemoModeNotice";
import PresenceHeartbeat from "@/components/PresenceHeartbeat";

const HIDE_NAV_PATHS = ["/landing", "/login", "/register", "/forgot-password", "/reset-password"];

export default function AppLayout() {
  const location = useLocation();
  const hideNav = HIDE_NAV_PATHS.some(p => location.pathname.startsWith(p));
  // Home renders its own notice beneath the logo, so avoid a duplicate here.
  const showHere = location.pathname !== "/";

  return (
    <div className="min-h-screen bg-background">
      <PresenceHeartbeat />
      <main className={hideNav ? "" : "pb-24"}>
        {showHere && (
          <div className="px-5 pt-6">
            <DemoModeNotice />
          </div>
        )}
        <Outlet />
      </main>
      {!hideNav && <BottomNav />}
    </div>
  );
}