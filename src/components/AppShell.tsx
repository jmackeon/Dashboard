import { NavLink } from "react-router-dom";
import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import AvatarButton from "./AvatarButton";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { role, session } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  // Pull identity directly from the session already held in AuthContext.
  // No async call needed → no flicker. Session is populated before any
  // protected page renders, so this is always fresh by the time we get here.
  const meta     = session?.user?.user_metadata ?? {};
  const fullName = meta.full_name || meta.name || session?.user?.email?.split("@")[0] || "";
  const email    = session?.user?.email ?? "";
  const avatar   = meta.avatar_url ?? meta.picture ?? null;

  const logout = () => supabase.auth.signOut();

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    isActive
      ? "relative px-3 py-2 text-sm font-semibold text-[#1a2e44] transition after:absolute after:bottom-0 after:left-3 after:right-3 after:h-0.5 after:rounded-full after:bg-[#1a2e44] after:content-['']"
      : "px-3 py-2 text-sm font-medium text-gray-500 transition hover:text-gray-800";

  return (
    <div className="min-h-screen bg-[#F7F8FA]">

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 border-b border-gray-100 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">

          {/* User identity — reads synchronously from context, never flickers */}
          <div className="flex items-center gap-3">
            <AvatarButton src={avatar} size={36} />
            <div className="hidden leading-tight sm:block">
              {fullName ? (
                <p className="text-sm font-semibold text-gray-800">{fullName}</p>
              ) : (
                // Skeleton shown only on very first load before session resolves
                <div className="h-3.5 w-28 animate-pulse rounded bg-gray-100" />
              )}
              {email ? (
                <p className="text-xs text-gray-400">{email}</p>
              ) : (
                <div className="mt-1 h-2.5 w-36 animate-pulse rounded bg-gray-100" />
              )}
            </div>
          </div>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 md:flex">
            <NavLink to="/dashboard" className={linkClass}>Dashboard</NavLink>
            <NavLink to="/history"   className={linkClass}>History</NavLink>
            {role === "ADMIN" && (
              <NavLink to="/updates" className={linkClass}>Updates</NavLink>
            )}
            {role === "ADMIN" && (
              <NavLink to="/reports" className={linkClass}>Weekly Report</NavLink>
            )}

            <span className="mx-2 h-4 w-px bg-gray-200" />

            <button
              onClick={logout}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-500 transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-700"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
                <path d="M11 11l3-3-3-3" />
                <path d="M14 8H6" />
              </svg>
              Sign out
            </button>
          </nav>

          {/* Mobile menu toggle */}
          <button
            type="button"
            onClick={() => setMenuOpen(v => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 md:hidden"
            aria-expanded={menuOpen}
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              {menuOpen
                ? <><path d="M2 2l12 12M14 2L2 14" /></>
                : <><path d="M2 4h12M2 8h12M2 12h12" /></>}
            </svg>
            {menuOpen ? "Close" : "Menu"}
          </button>
        </div>

        {/* Mobile dropdown */}
        {menuOpen && (
          <div className="border-t border-gray-100 bg-white md:hidden">
            <nav className="mx-auto flex max-w-6xl flex-col gap-0.5 px-4 py-3">
              <MobileLink to="/dashboard" onClick={() => setMenuOpen(false)}>Dashboard</MobileLink>
              <MobileLink to="/history"   onClick={() => setMenuOpen(false)}>History</MobileLink>
              {role === "ADMIN" && (
                <MobileLink to="/updates" onClick={() => setMenuOpen(false)}>Updates</MobileLink>
              )}
              {role === "ADMIN" && (
                <MobileLink to="/reports" onClick={() => setMenuOpen(false)}>Weekly Report</MobileLink>
              )}
              <div className="mt-2 border-t border-gray-100 pt-2">
                <button
                  onClick={logout}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
                    <path d="M11 11l3-3-3-3" />
                    <path d="M14 8H6" />
                  </svg>
                  Sign out
                </button>
              </div>
            </nav>
          </div>
        )}
      </div>

      {/* Page content */}
      <div className="mx-auto max-w-6xl px-4 py-5 md:px-6 md:py-7">
        {children}
      </div>
    </div>
  );
}

// ─── Mobile nav link ──────────────────────────────────────────────────────────

function MobileLink({
  to, onClick, children,
}: {
  to: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        isActive
          ? "rounded-lg bg-[#f0f4f8] px-3 py-2 text-sm font-semibold text-[#1a2e44]"
          : "rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-800"
      }
    >
      {children}
    </NavLink>
  );
}
