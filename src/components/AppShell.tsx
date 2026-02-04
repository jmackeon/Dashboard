import { NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import AvatarButton from "./AvatarButton";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { role } = useAuth();

  const [menuOpen, setMenuOpen] = useState(false);

  const [avatar, setAvatar] = useState<string | null>(null);
  const [fullName, setFullName] = useState("Admin");
  const [email, setEmail] = useState("admin@elitelac.com");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setFullName(data.user.user_metadata?.full_name || "Admin");
        setAvatar(data.user.user_metadata?.avatar_url || null);
        setEmail(data.user.email || email);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = () => supabase.auth.signOut();

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-full px-4 py-2 text-sm font-semibold transition ${
      isActive ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-100"
    }`;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 p-4">
          {/* User info */}
          <div className="flex items-center gap-3">
            <AvatarButton src={avatar} size={40} />
            <div className="leading-tight">
              <div className="text-sm font-semibold text-gray-900">
                {fullName}
              </div>
              <div className="text-xs text-gray-600">{email}</div>
            </div>
          </div>

          {/* Desktop navigation */}
          <div className="hidden items-center gap-2 md:flex">
            <NavLink to="/dashboard" className={linkClass}>
              Dashboard
            </NavLink>
            <NavLink to="/history" className={linkClass}>
              History
            </NavLink>
            {role === "ADMIN" && (
              <NavLink to="/updates" className={linkClass}>
                Updates
              </NavLink>
            )}
            {role === "ADMIN" && (
              <NavLink to="/reports" className={linkClass}>
                Weekly Report
              </NavLink>
            )}

            <button
              onClick={logout}
              className="ml-2 rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
              title="Logout"
            >
              Logout
            </button>
          </div>

          {/* Mobile menu button */}
          <div className="flex items-center gap-2 md:hidden">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-full border bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              aria-expanded={menuOpen}
              aria-label="Open menu"
            >
              Menu
            </button>
          </div>
        </div>

        {/* Mobile dropdown */}
        {menuOpen && (
          <div className="border-t bg-white md:hidden">
            <div className="mx-auto max-w-6xl p-3">
              <div className="flex flex-wrap gap-2">
                <NavLink to="/dashboard" className={linkClass} onClick={() => setMenuOpen(false)}>
                  Dashboard
                </NavLink>
                <NavLink to="/history" className={linkClass} onClick={() => setMenuOpen(false)}>
                  History
                </NavLink>
                {role === "ADMIN" && (
                  <NavLink to="/updates" className={linkClass} onClick={() => setMenuOpen(false)}>
                    Updates
                  </NavLink>
                )}
                {role === "ADMIN" && (
                  <NavLink to="/reports" className={linkClass} onClick={() => setMenuOpen(false)}>
                    Weekly Report
                  </NavLink>
                )}

                <button
                  onClick={logout}
                  className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                  title="Logout"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Page content */}
      <div className="mx-auto max-w-6xl p-4 md:p-6">{children}</div>
    </div>
  );
}
