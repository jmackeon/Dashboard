import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";

export type UserRole = "ADMIN" | "PRESIDENT" | "STAFF";

interface AuthShape {
  session: Session | null;
  loading: boolean;     // auth loading
  roleLoading: boolean; // role loading
  role: UserRole;
  email: string | null;
}

const AuthContext = createContext<AuthShape>({
  session: null,
  loading: true,
  roleLoading: true,
  role: "STAFF",
  email: null,
});

export const useAuth = () => useContext(AuthContext);

function normalizeEmail(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s ? s : null;
}

function normalizeRole(v: unknown): UserRole {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return s === "ADMIN" || s === "PRESIDENT" || s === "STAFF" ? (s as UserRole) : "STAFF";
}

async function getRoleFromBackend(accessToken: string) {
  const base = (import.meta as any).env?.VITE_API_BASE_URL || "http://localhost:10000";

  const res = await fetch(`${base}/api/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`api/me failed (${res.status}): ${txt}`);
  }

  return res.json() as Promise<{ email: string; role: string; is_active: boolean }>;
}

/**
 * Role requests can overlap (boot + refresh + auth state change).
 * If an older request finishes later, it should NOT overwrite the latest.
 *
 * UI glitch fix:
 * - On refresh, Supabase may emit TOKEN_REFRESHED / INITIAL_SESSION events.
 * - We should NOT flip roleLoading back to true if we already have a good role.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<UserRole>("STAFF");
  const [loading, setLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(true);

  const email = useMemo(() => normalizeEmail(session?.user?.email), [session]);

  const reqIdRef = useRef(0);
  const lastGoodRoleRef = useRef<UserRole>("STAFF");

  function hasGoodRole(r: UserRole) {
    return r === "ADMIN" || r === "PRESIDENT";
  }

  async function resolveRole(nextSession: Session | null, opts?: { silent?: boolean }) {
    const reqId = ++reqIdRef.current;

    // If we already had a good role, do not show the full-screen loader again.
    const goodAlready = hasGoodRole(lastGoodRoleRef.current);
    const blockUI = !(opts?.silent || goodAlready);

    if (blockUI) setRoleLoading(true);

    try {
      const token = nextSession?.access_token;

      if (!token) {
        if (reqId !== reqIdRef.current) return;
        setRole("STAFF");
        lastGoodRoleRef.current = "STAFF";
        return;
      }

      const me = await getRoleFromBackend(token);

      if (reqId !== reqIdRef.current) return;

      const r = normalizeRole(me?.role);
      const active = !!me?.is_active;

      if (active && hasGoodRole(r)) {
        setRole(r);
        lastGoodRoleRef.current = r;
      } else {
        setRole("STAFF");
        lastGoodRoleRef.current = "STAFF";
      }
    } catch (e: any) {
      if (reqId !== reqIdRef.current) return;

      console.error("Role resolve crashed:", e?.message || e);

      // Keep last known good role if backend is down / temporary failure
      setRole(lastGoodRoleRef.current);
    } finally {
      if (reqId === reqIdRef.current) setRoleLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;

    async function boot() {
      try {
        const { data } = await supabase.auth.getSession();
        const s = (data.session ?? null) as Session | null;
        if (!alive) return;

        setSession(s);
        setLoading(false);

        // Boot should be a real check (not silent)
        await resolveRole(s, { silent: false });
      } catch (e: any) {
        if (!alive) return;
        console.error("Auth boot failed:", e?.message || e);

        setSession(null);
        setRole("STAFF");
        lastGoodRoleRef.current = "STAFF";
        setLoading(false);
        setRoleLoading(false);
      }
    }

    boot();

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, s) => {
      if (!alive) return;

      const next = (s ?? null) as Session | null;
      setSession(next);
      setLoading(false);

      // These events happen on refresh/recovery. Do it silently to avoid UI flicker.
      const silent =
        event === "TOKEN_REFRESHED" ||
        event === "INITIAL_SESSION" ||
        event === "SIGNED_IN";

      await resolveRole(next, { silent });
    });

    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading, roleLoading, role, email }}>
      {children}
    </AuthContext.Provider>
  );
}
