import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";

export default function AdminGuard() {
  const { user } = useAuth();
  if (user?.role !== "admin") return <Navigate to="/" replace />;
  return <Outlet />;
}
