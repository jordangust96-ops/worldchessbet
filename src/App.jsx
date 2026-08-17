import { lazy, Suspense } from "react";
import { HelmetProvider } from "react-helmet-async";
import { BrowserRouter as Router, useLocation } from "react-router-dom";
import ScrollToTop from "@/components/ScrollToTop";
import GoogleAnalyticsTracker from "@/components/GoogleAnalyticsTracker";
import MetaPixelTracker from "@/components/MetaPixelTracker";
import Landing from "@/pages/Landing";

const AuthenticatedApplication = lazy(() => import("@/AuthenticatedApplication"));

function LoadingScreen() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#0A0A0A]">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/10 border-t-[#C9A84C]" />
    </div>
  );
}

function hasBase44Session(search) {
  const params = new URLSearchParams(search);
  if (params.has("access_token") || params.get("clear_access_token") === "true") {
    return true;
  }

  try {
    return Boolean(
      window.localStorage.getItem("base44_access_token") ||
      window.localStorage.getItem("token")
    );
  } catch {
    return false;
  }
}

function ApplicationRouter() {
  const location = useLocation();
  const showLeanPublicLanding =
    location.pathname === "/" && !hasBase44Session(location.search);

  return (
    <>
      <ScrollToTop />
      <GoogleAnalyticsTracker />
      <MetaPixelTracker />
      {showLeanPublicLanding ? (
        <Landing />
      ) : (
        <Suspense fallback={<LoadingScreen />}>
          <AuthenticatedApplication />
        </Suspense>
      )}
    </>
  );
}

export default function App() {
  return (
    <HelmetProvider>
      <Router>
        <ApplicationRouter />
      </Router>
    </HelmetProvider>
  );
}
