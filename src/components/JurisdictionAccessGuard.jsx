import { useEffect, useRef, useState } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { MapPin, ShieldAlert, LogOut } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { base44 } from "@/api/base44Client";
import { evaluateJurisdictionAccess, getJurisdictionCheck } from "@/lib/jurisdictionAccess";
import { APPROVED_STATES } from "@/lib/jurisdictionConfig";
import { getRegionName } from "@/lib/jurisdictionRegions";
import { Button } from "@/components/ui/button";
import JurisdictionWaitlistOptIn from "@/components/jurisdiction/JurisdictionWaitlistOptIn";

// Layout guard that gates every protected product/admin page behind a single
// authenticated MaxMind access check. Called once per authenticated user id
// (deduplicated across StrictMode/concurrent mounts via getJurisdictionCheck).
// No retry, timer, focus/visibility/navigation listener, or local/session
// storage. Never logs raw response, IP, or provider diagnostics.

const BLOCKED_COPY =
  "Unfortunately, real-money play is not currently available in your location. ChessBet has not yet enabled real-money play in your state or country under its current launch requirements.";
const OPT_IN_QUESTION =
  "We’re continually working to expand access. Would you like us to email you when ChessBet becomes available in your selected location?";

function PendingScreen() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary" />
      <p className="font-body text-sm text-muted-foreground">Checking availability…</p>
    </div>
  );
}

function ApprovedJurisdictionsCard() {
  return (
    <div className="w-full rounded-2xl border border-border bg-card/60 p-4">
      <div className="mb-2 flex items-center justify-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <MapPin className="h-3.5 w-3.5 text-primary" />
        Approved jurisdictions
      </div>
      <p className="font-body text-sm text-foreground">
        Currently approved in the United States: {APPROVED_STATES.map((s) => getRegionName(s) || s).join(", ")}.
      </p>
    </div>
  );
}

function UnavailableScreen({ reason, promptEligible, userEmail, onSignOut }) {
  const message = reason || BLOCKED_COPY;
  return (
    <div className="fixed inset-0 overflow-y-auto bg-background">
      <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-6 px-6 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 border border-primary/20">
          <ShieldAlert className="h-7 w-7 text-primary" />
        </div>

        <div className="space-y-2">
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
            ChessBet isn’t available in your location
          </h1>
          <p className="font-body text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
            {message}
          </p>
        </div>

        <ApprovedJurisdictionsCard />

        {promptEligible && (
          <>
            <p className="font-body text-sm text-foreground">{OPT_IN_QUESTION}</p>
            <JurisdictionWaitlistOptIn userEmail={userEmail} />
          </>
        )}

        <Button onClick={onSignOut} variant="default" className="w-full">
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>

        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs">
          <Link to="/faq" className="text-primary underline-offset-4 hover:underline">
            FAQ
          </Link>
          <span className="text-border">·</span>
          <Link to="/terms-of-service" className="text-primary underline-offset-4 hover:underline">
            Terms of Service
          </Link>
          <span className="text-border">·</span>
          <Link to="/privacy-policy" className="text-primary underline-offset-4 hover:underline">
            Privacy Policy
          </Link>
        </nav>
      </div>
    </div>
  );
}

export default function JurisdictionAccessGuard() {
  const { user, logout } = useAuth();
  const location = useLocation();
  // null while the check is pending; { allowed, reason, promptEligible } once settled.
  const [decision, setDecision] = useState(null);
  // Tracks the user id we have already initiated a check for, so re-renders
  // (and StrictMode double-mount) never trigger a second provider call.
  const initiatedFor = useRef(null);
  // Guards against state updates after unmount without cancelling the shared
  // in-flight promise (other concurrent callers may still be awaiting it).
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      // No authenticated user id — fail closed immediately.
      if (mountedRef.current) setDecision({ allowed: false, reason: "", promptEligible: false });
      return;
    }
    if (initiatedFor.current === userId) return; // already initiated for this user
    initiatedFor.current = userId;

    getJurisdictionCheck(
      userId,
      () => base44.functions.invoke("getCurrentJurisdiction", { triggerEvent: "app_access" }),
    )
      .then((result) => {
        if (!mountedRef.current) return;
        // Normalize the Base44 invoke wrapper to the function response.
        const response = result?.data ?? result;
        setDecision(evaluateJurisdictionAccess(response));
      })
      .catch(() => {
        if (!mountedRef.current) return;
        // Any rejection or thrown error fails closed; no diagnostic logging.
        setDecision({ allowed: false, reason: "", promptEligible: false });
      });
  }, [user]);

  if (!decision) return <PendingScreen />;
  if (!decision.allowed) {
    // Paid contests require an approved jurisdiction, but a user's own wallet
    // balance does not stop being theirs because of where they are. The
    // Wallet page (balance display + withdrawal) stays reachable even when
    // jurisdiction is blocked; every other protected route still shows the
    // unavailable screen. WalletPage and its panels are responsible for
    // keeping deposit/gameplay actions gated behind the decision passed via
    // outlet context.
    if (location.pathname.startsWith("/wallet")) {
      return <Outlet context={decision} />;
    }
    return (
      <UnavailableScreen
        reason={decision.reason}
        promptEligible={decision.promptEligible}
        userEmail={user?.email}
        onSignOut={() => logout()}
      />
    );
  }
  return <Outlet context={decision} />;
}