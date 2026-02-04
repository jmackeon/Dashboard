import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function Unauthorized() {
  const { session, loading, roleLoading, role } = useAuth();

  // wait for auth + role
  if (loading || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-600">
        Loading...
      </div>
    );
  }

  // not logged in
  if (!session) {
    return <Navigate to="/login" replace />;
  }

  // ✅ if role becomes valid after a moment, auto send back to dashboard
  if (role === "ADMIN" || role === "PRESIDENT") {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm text-center">
        <h1 className="text-xl font-bold text-gray-900">Access Denied</h1>
        <p className="mt-2 text-sm text-gray-600">
          Your account is signed in, but you don’t have permission to view this page.
        </p>
        <p className="mt-2 text-xs text-gray-500">
          Please contact the Admin to grant you the correct role (ADMIN or PRESIDENT).
        </p>
      </div>
    </div>
  );
}
