import { Navigate, useLocation } from "react-router-dom";
import { useAuthState } from "../hooks/useAuthState.js";
import Login from "../components/Login.jsx";

export default function LoginPage() {
  const { user, loading } = useAuthState();
  const loc = useLocation();
  if (loading) return null;
  if (user) return <Navigate to="/app" replace state={{ from: loc }} />;
  return <Login />;
}
