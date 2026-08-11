import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { clearMfaVerified, getMfaSessionToken } from "@/lib/mfaSession";

export default function MfaGuard() {
  const [status, setStatus] = useState("checking");
  const token = getMfaSessionToken();

  useEffect(() => {
    let active = true;
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
  }, [token]);

  if (status === "checking") {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#0A0A0A]">
        <div className="w-8 h-8 border-4 border-white/10 border-t-[#C9A84C] rounded-full animate-spin" />
      </div>
    );
  }
  if (status !== "valid") return <Navigate to="/verify-mfa" replace />;
  return <Outlet />;
}
