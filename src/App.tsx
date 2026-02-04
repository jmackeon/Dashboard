import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import type { JSX } from "react";
import { AuthProvider, useAuth } from "./contexts/AuthContext";

import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import ExecutiveDashboard from "./pages/ExecutiveDashboard";
import Updates from "./pages/Updates";
import WeeklyReport from "./pages/WeeklyReport";
import History from "./pages/History";
import Unauthorized from "./pages/Unauthorized";
import RoleGuard from "./components/RoleGuard";

/**
 * PrivateRoute
 * Waits for Supabase auth to resolve before deciding.
 */
function PrivateRoute({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-600">
        Loading dashboard...
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* Protected routes */}
        <Route
          element={
            <PrivateRoute>
              <Outlet />
            </PrivateRoute>
          }
        >
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          {/* ✅ Important: Unauthorized page exists and won't loop */}
          <Route path="/unauthorized" element={<Unauthorized />} />

          <Route
            path="/dashboard"
            element={
              <RoleGuard allow={["ADMIN", "PRESIDENT"]}>
                <ExecutiveDashboard />
              </RoleGuard>
            }
          />

          <Route
            path="/history"
            element={
              <RoleGuard allow={["ADMIN", "PRESIDENT"]}>
                <History />
              </RoleGuard>
            }
          />

          <Route
            path="/updates"
            element={
              <RoleGuard allow={["ADMIN"]}>
                <Updates />
              </RoleGuard>
            }
          />

          <Route
            path="/reports"
            element={
              <RoleGuard allow={["ADMIN"]}>
                <WeeklyReport />
              </RoleGuard>
            }
          />

          {/* Fallback inside protected area */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
