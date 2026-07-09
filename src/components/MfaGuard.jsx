import { Navigate, Outlet } from "react-router-dom";
import { isMfaVerified } from "@/lib/mfaSession";

// Sits inside ProtectedRoute: the user already holds a valid session token
// here, but every protected page still requires the MFA second factor to
// have been completed for this session before rendering.
export default function MfaGuard() {
  if (!isMfaVerified()) {
    return <Navigate to="/verify-mfa" replace />;
  }
  return <Outlet />;
}