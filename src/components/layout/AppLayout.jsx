import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import BottomNav from "./BottomNav";
import PresenceHeartbeat from "@/components/PresenceHeartbeat";
import AdminActionAlert from "@/components/admin/AdminActionAlert";
import { useAuth } from "@/lib/AuthContext";

const HIDE_NAV_PATHS = ["/login", "/register", "/forgot-password", "/reset-password"];

export default function AppLayout({ playScreen = false, header = null }) {
  const { user } = useAuth();
  const location = useLocation();
  const hideNav = HIDE_NAV_PATHS.some(p => location.pathname.startsWith(p));
  // Home, Wallet, and Profile each render their own notice beneath their
  // header logo, so avoid a duplicate here.
  const NOTICE_RENDERED_BY_PAGE = ["/play", "/wallet", "/profile"];
  const showHere = !NOTICE_RENDERED_BY_PAGE.includes(location.pathname);

  return (
    <div className={`bg-background ${playScreen ? "min-h-dvh lg:flex lg:h-[calc(100dvh-var(--app-safe-top))] lg:min-h-0 lg:flex-col" : "min-h-screen"}`}>
      {user && <PresenceHeartbeat />}
      {header}

      <main className={hideNav ? "" : `app-page-with-nav ${playScreen ? "play-page-with-nav lg:flex lg:min-h-0 lg:flex-1 lg:flex-col" : ""}`}>
        {!hideNav && user?.role === "admin" && <AdminActionAlert />}
        {showHere && (
          <div className="px-5 pt-6">
          </div>
        )}
        <Outlet />
      </main>
      {!hideNav && <BottomNav />}
    </div>
  );
}