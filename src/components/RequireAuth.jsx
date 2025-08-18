import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthState } from "../hooks/useAuthState.js";

export default function RequireAuth() {
  const { user, loading } = useAuthState();
  const loc = useLocation();

  if (loading) return null; // o un spinner
  if (!user) return <Navigate to="/" replace state={{ from: loc }} />;

  return <Outlet />;
}
