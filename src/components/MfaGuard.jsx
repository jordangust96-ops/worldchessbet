import { Navigate, Outlet } from "react-router-dom";
import { isMfaVerified } from "@/lib/mfaSession";
import { useAuth } from "@/lib/AuthContext";

// This admin account never requires the 2FA second factor.
const MFA_EXEMPT_EMAILS = ["jordangust96@gmail.com"];

// Sits inside ProtectedRoute: the user already holds a valid session token
// here, but every protected page still requires the MFA second factor to
// have been completed for this session before rendering.
export default function MfaGuard() {
  const { user } = useAuth();
  const isExempt = MFA_EXEMPT_EMAILS.includes(user?.email);

  if (!isExempt && !isMfaVerified()) {
    return <Navigate to="/verify-mfa" replace />;
  }
  return <Outlet />;
}