import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

export default function Login() {
  const nav = useNavigate();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [authMethod, setAuthMethod] = useState<"google" | "magic">("google");

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

    if (!cleanEmail.endsWith("@elitelac.com")) {
      return setErr("Only @elitelac.com emails are allowed.");
    }

    try {
      setLoading(true);

      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          shouldCreateUser: false,
        },
      });

      if (error) throw error;

      setMsg("Check your email for a sign-in link.");
    } catch (e: any) {
      const m = e?.message || "Failed to send sign-in link.";
      setErr(
        m.toLowerCase().includes("signup")
          ? "This email is not authorized for this dashboard."
          : m
      );
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
    <div className="min-h-screen flex items-center justify-center p-6 
                    bg-gradient-to-br from-gray-100 via-gray-50 to-gray-200">

      <div className="w-full max-w-md rounded-2xl bg-white p-8 
                      shadow-2xl border border-gray-200">

        {/* Logo */}
        <div className="flex justify-center">
          <img
            src="/logo-school.png"
            alt="School Logo"
            className="h-20 w-auto"
          />
        </div>

        <h1 className="mt-6 text-2xl font-semibold text-[#1F3D2B] text-center tracking-tight">
          LAC Dashboard
        </h1>

        <p className="mt-1 text-sm text-gray-500 text-center">
          Executive access
        </p>

        {/* Alerts */}
        {msg && (
          <div className="mt-5 rounded-xl bg-[#E7F1EC] p-3 text-sm 
                          text-[#166534] border border-[#CDE5D8]">
            {msg}
          </div>
        )}

        {err && (
          <div className="mt-5 rounded-xl bg-red-50 p-3 text-sm 
                          text-red-800 border border-red-200">
            {err}
          </div>
        )}

        {/* Toggle (Google First) */}
        <div className="mt-6 flex rounded-xl border border-gray-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setAuthMethod("google")}
            className={`flex-1 px-4 py-2 text-sm font-semibold transition
              ${
                authMethod === "google"
                  ? "bg-[#1F3D2B] text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
          >
            Google
          </button>

          <button
            type="button"
            onClick={() => setAuthMethod("magic")}
            className={`flex-1 px-4 py-2 text-sm font-semibold transition
              ${
                authMethod === "magic"
                  ? "bg-[#1F3D2B] text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
          >
            Magic Link
          </button>
        </div>

        {/* Google Sign In */}
        {authMethod === "google" && (
          <div className="mt-5">
            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={loading}
              className="w-full rounded-xl bg-[#1F3D2B] 
                         hover:bg-[#183023] 
                         px-4 py-2 text-sm font-semibold text-white 
                         transition disabled:opacity-60"
            >
              {loading ? "Loading..." : "Continue with Google"}
            </button>

            <p className="mt-2 text-xs text-gray-500 text-center">
              Use your <span className="font-semibold">@elitelac.com</span> account.
            </p>
          </div>
        )}

        {/* Magic Link */}
        {authMethod === "magic" && (
          <form onSubmit={sendMagicLink} className="mt-5 space-y-3">
            <label className="block text-sm font-semibold text-gray-700">
              Email
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@londonacademy.ma"
                className="mt-1 w-full rounded-xl border border-gray-300 
                           px-4 py-2 text-sm outline-none transition
                           focus:ring-2 focus:ring-[#1F3D2B] 
                           focus:border-[#1F3D2B]"
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[#1F3D2B] 
                         hover:bg-[#183023] 
                         px-4 py-2 text-sm font-semibold text-white 
                         transition disabled:opacity-60"
            >
              {loading ? "Sending..." : "Send sign-in link"}
            </button>

            <p className="text-xs text-gray-500 text-center">
              We’ll email you a secure link. Click it to sign in.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
