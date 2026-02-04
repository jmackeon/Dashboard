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

function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "t" || s === "1" || s === "yes";
  }
  return false;
}

/**
 * Important fix:
 * - role requests can overlap (boot + refresh + auth state change)
 * - if an older request times out later, it should NOT overwrite the latest good role
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<UserRole>("STAFF");
  const [loading, setLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(true);

  const email = useMemo(() => normalizeEmail(session?.user?.email), [session]);

  const reqIdRef = useRef(0);
  const lastGoodRoleRef = useRef<UserRole>("STAFF");

  async function resolveRole(nextSession: Session | null) {
    const reqId = ++reqIdRef.current;
    setRoleLoading(true);

    try {
      if (!nextSession?.user?.id) {
        if (reqId !== reqIdRef.current) return;
        setRole("STAFF");
        lastGoodRoleRef.current = "STAFF";
        return;
      }

      // ✅ Use a longer timeout; 7s can be too aggressive when Supabase refreshes.
      const timeoutMs = 20000;

      const rpcPromise = supabase.rpc("get_my_role") as any;

      const { data, error } = await Promise.race([
        Promise.resolve(rpcPromise),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Role lookup timeout")), timeoutMs)),
      ]) as any;

      // if another newer request started, ignore this result
      if (reqId !== reqIdRef.current) return;

      if (error) {
        console.error("get_my_role failed:", error.message);
        // don't downgrade if we already have a good role
        setRole(lastGoodRoleRef.current);
        return;
      }

      // handle RPC returning array or object
      const row = Array.isArray(data) ? data[0] : data;

      const r = normalizeRole(row?.role);
      const active = toBool(row?.is_active);

      if (active && r !== "STAFF") {
        setRole(r);
        lastGoodRoleRef.current = r;
        return;
      }

      // If inactive or missing role, treat as STAFF (but still protect from overwriting newer results)
      setRole("STAFF");
      lastGoodRoleRef.current = "STAFF";
    } catch (e: any) {
      // if another newer request started, ignore this crash
      if (reqId !== reqIdRef.current) return;

      console.error("Role resolve crashed:", e?.message || e);

      // ✅ key change: don't force STAFF on timeout/crash if we already had a role
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

        await resolveRole(s);
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

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (!alive) return;

      const next = (s ?? null) as Session | null;
      setSession(next);
      setLoading(false);

      await resolveRole(next);
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
