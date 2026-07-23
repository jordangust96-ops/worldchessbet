import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import BottomNav from "./BottomNav";
import DemoModeNotice from "@/components/DemoModeNotice";
import PresenceHeartbeat from "@/components/PresenceHeartbeat";
import useSiteVisitLogger from "@/hooks/useSiteVisitLogger";

const HIDE_NAV_PATHS = ["/landing", "/login", "/register", "/forgot-password", "/reset-password"];

export default function AppLayout() {
  useSiteVisitLogger();
  const location = useLocation();
  const hideNav = HIDE_NAV_PATHS.some(p => location.pathname.startsWith(p));
  // Home, Wallet, and Profile each render their own notice beneath their
  // header logo, so avoid a duplicate here.
  const NOTICE_RENDERED_BY_PAGE = ["/", "/wallet", "/profile"];
  const showHere = !NOTICE_RENDERED_BY_PAGE.includes(location.pathname);

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