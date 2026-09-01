import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import BottomNav from "./BottomNav";
import PresenceHeartbeat from "@/components/PresenceHeartbeat";
import AdminActionAlert from "@/components/admin/AdminActionAlert";
import { useAuth } from "@/lib/AuthContext";

const HIDE_NAV_PATHS = ["/login", "/register", "/forgot-password", "/reset-password"];

export default function AppLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const hideNav = HIDE_NAV_PATHS.some(p => location.pathname.startsWith(p));
  // Home, Wallet, and Profile each render their own notice beneath their
  // header logo, so avoid a duplicate here.
  const NOTICE_RENDERED_BY_PAGE = ["/play", "/wallet", "/profile"];
  const showHere = !NOTICE_RENDERED_BY_PAGE.includes(location.pathname);

  return (
    <div className="min-h-screen bg-background">
      {user && <PresenceHeartbeat />}
      <main className={hideNav ? "" : "pb-24"}>
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