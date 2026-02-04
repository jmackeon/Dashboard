import { Navigate } from "react-router-dom";
import { useAuth, type UserRole } from "../contexts/AuthContext";
import type { JSX } from "react";

export default function RoleGuard({
  allow,
  children,
}: {
  allow: UserRole[];
  children: JSX.Element;
}) {
  const { session, role, loading, roleLoading } = useAuth();

  // ⏳ wait for auth + role to resolve
  if (loading || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-600">
        Loading...
      </div>
    );
  }

  // 🔐 not logged in
  if (!session) {
    return <Navigate to="/login" replace />;
  }

  // 🚫 logged in but not allowed
  if (!allow.includes(role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  // ✅ allowed
  return children;
}
