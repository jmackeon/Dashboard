import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:10000";

async function fetchRole(token: string): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return "STAFF";
    const data = await res.json();
    return typeof data?.role === "string" ? data.role.toUpperCase() : "STAFF";
  } catch {
    return "STAFF";
  }
}

function homeFor(role: string) {
  return role === "ADMIN" || role === "PRESIDENT" ? "/dashboard" : "/unauthorized";
}

export default function AuthCallback() {
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const url = new URL(window.location.href);

        // 1) Already signed in
        const { data: existing } = await supabase.auth.getSession();
        if (existing?.session) {
          const role = await fetchRole(existing.session.access_token);
          nav(homeFor(role), { replace: true });
          return;
        }

        // 2) OAuth / PKCE code
        const code = url.searchParams.get("code");
        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(window.location.href);
          if (error) throw error;
          const role = data.session ? await fetchRole(data.session.access_token) : "STAFF";
          nav(homeFor(role), { replace: true });
          return;
        }

        // 3) Magic link
        const token_hash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type");
        if (token_hash && type) {
          const { data, error } = await supabase.auth.verifyOtp({ token_hash, type: type as any });
          if (error) throw error;
          const role = data.session ? await fetchRole(data.session.access_token) : "STAFF";
          nav(homeFor(role), { replace: true });
          return;
        }

        nav("/login", { replace: true });
      } catch (e: any) {
        console.error("Auth callback error:", e?.message || e);
        nav("/login", { replace: true });
      }
    })();
  }, [nav]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-gray-500">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-gray-600" />
      <span className="text-sm">Signing you in…</span>
    </div>
  );
}
