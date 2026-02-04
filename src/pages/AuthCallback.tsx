import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

export default function AuthCallback() {
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const href = window.location.href;
        const url = new URL(href);

        // 1) If we already have a session, just go in
        const { data: existing } = await supabase.auth.getSession();
        if (existing?.session) {
          nav("/dashboard", { replace: true });
          return;
        }

        // 2) PKCE/OAuth code flow
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(href);
          if (error) throw error;

          nav("/dashboard", { replace: true });
          return;
        }

        // 3) Token-hash magic link flow (works cross-device IF your link includes token_hash)
        const token_hash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type"); // e.g. "magiclink"
        if (token_hash && type) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash,
            type: type as any,
          });
          if (error) throw error;

          nav("/dashboard", { replace: true });
          return;
        }

        console.error("Auth callback error: missing code/token_hash params");
        nav("/login", { replace: true });
      } catch (e: any) {
        console.error("Auth callback error:", e?.message || e);
        nav("/login", { replace: true });
      }
    })();
  }, [nav]);

  return (
    <div className="min-h-screen flex items-center justify-center text-gray-600">
      Signing you in...
    </div>
  );
}
