import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

export default function Login() {
  const nav = useNavigate();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) nav("/dashboard", { replace: true });
    })();
  }, [nav]);

  async function sendMagicLink(e: React.FormEvent) {
  e.preventDefault();
  setErr(null);
  setMsg(null);

  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) return setErr("Enter your email address.");

  // optional: enforce domain
  if (!cleanEmail.endsWith("@elitelac.com")) {
    return setErr("Only @elitelac.com emails are allowed.");
  }

  try {
    setLoading(true);

    const { error } = await supabase.auth.signInWithOtp({
      email: cleanEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: false, // ✅ IMPORTANT: login-only (no signup)
      },
    });

    if (error) throw error;

    setMsg("Check your email for a sign-in link.");
  } catch (e: any) {
    // Helpful messages
    const msg = e?.message || "Failed to send sign-in link.";

    // if user is not in auth.users, you’ll typically see signup-related errors
    if (msg.toLowerCase().includes("signup") || msg.toLowerCase().includes("signups")) {
      setErr("This email is not authorized for this dashboard.");
    } else {
      setErr(msg);
    }
  } finally {
    setLoading(false);
  }
}


  async function signInWithGoogle() {
    setErr(null);
    setMsg(null);

    try {
      setLoading(true);

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) throw error;
    } catch (e: any) {
      setErr(e?.message || "Google sign-in failed.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex justify-center">
          <img src="/logo-school.png" alt="School Logo" className="h-14 w-auto" />
        </div>

        <h1 className="mt-4 text-2xl font-bold text-gray-900 text-center">LAC Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600 text-center">Executive access</p>

        {msg && (
          <div className="mt-4 rounded-xl bg-green-50 p-3 text-sm text-green-800 border border-green-100">
            {msg}
          </div>
        )}

        {err && (
          <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800 border border-red-100">
            {err}
          </div>
        )}

        <button
          type="button"
          onClick={signInWithGoogle}
          disabled={loading}
          className="mt-5 w-full rounded-xl border px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-60"
        >
          {loading ? "Loading..." : "Continue with Google"}
        </button>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-200" />
          <span className="text-xs text-gray-500">or</span>
          <div className="h-px flex-1 bg-gray-200" />
        </div>

        <form onSubmit={sendMagicLink} className="space-y-3">
          <label className="block text-sm font-semibold text-gray-700">
            Email
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@elitelac.com"
              className="mt-1 w-full rounded-xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900"
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? "Sending..." : "Send sign-in link"}
          </button>

          <p className="text-xs text-gray-500 text-center">
            We’ll email you a secure link. Click it to sign in.
          </p>
        </form>
      </div>
    </div>
  );
}
