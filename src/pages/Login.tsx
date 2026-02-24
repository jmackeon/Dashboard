import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

// ─── Google "G" SVG icon ───────────────────────────────────────────────────────
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <g>
        <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
        <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
        <path d="M3.964 10.707A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
        <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
      </g>
    </svg>
  );
}

// ─── Envelope icon ────────────────────────────────────────────────────────────
function EnvelopeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2"/>
      <path d="m22 7-8.97 5.7a1.94 1.94 0 01-2.06 0L2 7"/>
    </svg>
  );
}

export default function Login() {
  const nav = useNavigate();

  const [email,      setEmail]      = useState("");
  const [loading,    setLoading]    = useState(false);
  const [msg,        setMsg]        = useState<string | null>(null);
  const [err,        setErr]        = useState<string | null>(null);
  const [authMethod, setAuthMethod] = useState<"google" | "magic">("google");
  const [sent,       setSent]       = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) nav("/dashboard", { replace: true });
    })();
  }, [nav]);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setMsg(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return setErr("Enter your email address.");
    const ALLOWED_DOMAINS = ["@elitelac.com", "@londonacademy.ma"];
    if (!ALLOWED_DOMAINS.some(d => cleanEmail.endsWith(d))) {
      return setErr("Only @elitelac.com or @gmail.com emails are allowed.");
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
      setSent(true);
      setMsg("Check your inbox for a sign-in link.");
    } catch (e: any) {
      const m = e?.message || "Failed to send sign-in link.";
      setErr(m.toLowerCase().includes("signup")
        ? "This email is not authorised for this dashboard."
        : m);
    } finally {
      setLoading(false);
    }
  }

  async function signInWithGoogle() {
    setErr(null); setMsg(null);
    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
    } catch (e: any) {
      setErr(e?.message || "Google sign-in failed.");
      setLoading(false);
    }
  }

  const BRAND = "#1F3D2B";
  const BRAND_LIGHT = "#E8F0EA";

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{
        background: "linear-gradient(135deg, #f0f4f1 0%, #e8ede9 50%, #dde7de 100%)",
      }}
    >
      {/* Subtle grid texture overlay */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage: "radial-gradient(circle, #1F3D2B08 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      <div className="relative w-full max-w-sm">
        {/* Card */}
        <div
          className="rounded-3xl bg-white p-8 shadow-xl"
          style={{ boxShadow: "0 8px 40px rgba(31,61,43,0.12), 0 1px 3px rgba(31,61,43,0.08)" }}
        >
          {/* Logo + Brand */}
          <div className="flex flex-col items-center mb-7">
            {/* Logo with ring */}
            <div
              className="mb-4 rounded-full p-1"
              style={{ background: `linear-gradient(135deg, ${BRAND}, #2d5a3e)` }}
            >
              <div className="rounded-full bg-white p-0.5">
                <img
                  src="/logo-school.png"
                  alt="London Academy Casablanca"
                  className="h-16 w-16 rounded-full object-cover"
                />
              </div>
            </div>

            <h1
              className="text-2xl font-bold tracking-tight text-center"
              style={{ color: BRAND }}
            >
              LAC Dashboard
            </h1>
            <p className="mt-1 text-sm text-gray-400 tracking-wide">
              IT &amp; Digital Systems
            </p>
          </div>

          {/* ── Feedback banners ── */}
          {msg && !sent && (
            <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {msg}
            </div>
          )}
          {err && (
            <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {err}
            </div>
          )}

          {/* ── Sent state ── */}
          {sent ? (
            <div className="text-center py-4">
              <div
                className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
                style={{ background: BRAND_LIGHT }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 13V6a2 2 0 00-2-2H4a2 2 0 00-2 2v12c0 1.1.9 2 2 2h8"/>
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 01-2.06 0L2 7"/>
                  <path d="m16 19 2 2 4-4"/>
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-800">Check your inbox</p>
              <p className="mt-1 text-xs text-gray-400">
                We sent a sign-in link to <span className="font-medium text-gray-600">{email}</span>
              </p>
              <button
                onClick={() => { setSent(false); setMsg(null); setEmail(""); }}
                className="mt-4 text-xs font-semibold underline underline-offset-2"
                style={{ color: BRAND }}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <>
              {/* ── Auth method toggle ── */}
              <div
                className="mb-5 flex rounded-xl p-0.5"
                style={{ background: BRAND_LIGHT }}
              >
                {(["google", "magic"] as const).map(method => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => { setAuthMethod(method); setErr(null); setMsg(null); }}
                    className="flex-1 rounded-[10px] py-1.5 text-sm font-semibold transition-all duration-200"
                    style={
                      authMethod === method
                        ? { background: BRAND, color: "white", boxShadow: "0 1px 4px rgba(31,61,43,0.25)" }
                        : { background: "transparent", color: "#4B6B55" }
                    }
                  >
                    {method === "google" ? "Google" : "Email link"}
                  </button>
                ))}
              </div>

              {/* ── Google sign-in ── */}
              {authMethod === "google" && (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={signInWithGoogle}
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 hover:shadow disabled:opacity-60"
                  >
                    <GoogleIcon />
                    {loading ? "Redirecting…" : "Continue with Google"}
                  </button>

                  <div
                    className="rounded-xl px-4 py-3 text-xs leading-relaxed"
                    style={{ background: BRAND_LIGHT, color: "#2d5a3e" }}
                  >
                     Sign in with your{" "}
                    <span className="font-semibold">@elitelac.com</span> Google Workspace account.
                  </div>
                </div>
              )}

              {/* ── Magic link ── */}
              {authMethod === "magic" && (
                <form onSubmit={sendMagicLink} className="space-y-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Email address
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300">
                        <EnvelopeIcon />
                      </span>
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="you@elitelac.com"
                        className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm text-gray-800 outline-none transition placeholder:text-gray-300 focus:border-transparent focus:ring-2"
                        style={{ "--tw-ring-color": BRAND } as any}
                        autoComplete="email"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
                    style={{ background: `linear-gradient(135deg, ${BRAND}, #2d5a3e)` }}
                  >
                    {loading ? (
                      <>
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Sending…
                      </>
                    ) : (
                      "Send sign-in link"
                    )}
                  </button>

                  <p className="text-center text-xs text-gray-400">
                    We'll email a secure link. No password needed.
                  </p>
                </form>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <p className="mt-5 text-center text-xs text-gray-400">
          London Academy Casablanca — Restricted access
        </p>
      </div>
    </div>
  );
}