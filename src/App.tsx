import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import type { JSX } from "react";
import { AuthProvider, useAuth } from "./contexts/AuthContext";

import Login            from "./pages/Login";
import AuthCallback     from "./pages/AuthCallback";
import ExecutiveDashboard from "./pages/ExecutiveDashboard";
import Updates          from "./pages/Updates";
import History          from "./pages/History";
import WeeklyReport     from "./pages/WeeklyReport";
import Unauthorized     from "./pages/Unauthorized";
import RoleGuard        from "./components/RoleGuard";

// ─── Auth gate ────────────────────────────────────────────────────────────────

function PrivateRoute({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth();
  if (loading) return <Loader />;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

// ─── Post-login redirect based on role ────────────────────────────────────────

function RoleRedirect() {
  const { role, loading, roleLoading } = useAuth();
  if (loading || roleLoading) return <Loader />;
  if (role === "ADMIN" || role === "PRESIDENT") return <Navigate to="/dashboard" replace />;
  return <Navigate to="/unauthorized" replace />;
}

function Loader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <div className="h-3 w-3 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
        Loading…
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public */}
        <Route path="/login"         element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* Protected */}
        <Route element={<PrivateRoute><Outlet /></PrivateRoute>}>
          <Route path="/"            element={<RoleRedirect />} />
          <Route path="/unauthorized" element={<Unauthorized />} />

          {/* Dashboard — ADMIN sees full view, PRESIDENT sees overview */}
          <Route
            path="/dashboard"
            element={
              <RoleGuard allow={["ADMIN", "PRESIDENT"]}>
                <ExecutiveDashboard />
              </RoleGuard>
            }
          />

          {/* History — both roles */}
          <Route
            path="/history"
            element={
              <RoleGuard allow={["ADMIN", "PRESIDENT"]}>
                <History />
              </RoleGuard>
            }
          />

          {/* Updates — ADMIN only */}
          <Route
            path="/updates"
            element={
              <RoleGuard allow={["ADMIN"]}>
                <Updates />
              </RoleGuard>
            }
          />

          {/* Weekly Report — ADMIN only */}
          <Route
            path="/reports"
            element={
              <RoleGuard allow={["ADMIN"]}>
                <WeeklyReport />
              </RoleGuard>
            }
          />

          {/* Catch-all */}
          <Route path="*" element={<RoleRedirect />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}