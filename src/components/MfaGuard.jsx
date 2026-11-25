import LoadingScreen from "@/components/LoadingScreen";
import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { clearMfaVerified, getMfaSessionToken } from "@/lib/mfaSession";

export default function MfaGuard() {
  const { user } = useAuth();
  const [status, setStatus] = useState("checking");
  const token = getMfaSessionToken();

  useEffect(() => {
    let active = true;

    // Users with the permanent MFA bypass flag never need a second factor.
    if (user?.mfa_bypass === true) {
      clearMfaVerified();
      setStatus("valid");
      return;
    }

    const validate = async () => {
      if (!token) {
        if (active) setStatus("invalid");
        return;
      }
      try {
        const { data } = await base44.functions.invoke("validateMfaSession", {
          sessionToken: token,
        });
        if (active) setStatus(data?.valid ? "valid" : "invalid");
      } catch {
        clearMfaVerified();
        if (active) setStatus("invalid");
      }
    };
    validate();
    return () => {
      active = false;
    };
  }, [token, user]);

  if (status === "checking") {
    return <LoadingScreen />;
  }
  if (status !== "valid") return <Navigate to="/verify-mfa" replace />;
  return <Outlet />;
}