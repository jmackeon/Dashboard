// src/pages/Login.tsx
import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const nav = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword(form);
    if (error) setError(error.message);
    else nav('/', { replace: true });
  };

  return (
  <div
    className="min-h-screen bg-cover bg-center flex items-center justify-center"
    style={{ backgroundImage: "url('/Background.png')" }}
  >
    {/* translucent overlay so text pops */}
    <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
    
    <form
      onSubmit={handleSubmit}
      className="relative z-10 w-full max-w-sm
                 backdrop-blur-lg bg-white/25 border border-white/40
                 rounded-xl shadow-xl px-8 py-10 space-y-6"
    >
      {/* logo */}
      <img src="/logo-school.png" alt="logo" className="h-14 mx-auto" />

      <h1 className="text-2xl font-bold text-center text-white drop-shadow">
        London Academy&nbsp;Portal
      </h1>

      {error && (
        <p className="bg-red-500/20 text-red-800 p-2 rounded text-sm">
          {error}
        </p>
      )}

      <input
        className="w-full rounded-lg bg-white/80 backdrop-blur p-3
                   shadow-inner focus:ring-2 focus:ring-blue-500"
        placeholder="Email"
        type="email"
        value={form.email}
        onChange={e => setForm({ ...form, email: e.target.value })}
        required
      />

      <input
        className="w-full rounded-lg bg-white/80 backdrop-blur p-3
                   shadow-inner focus:ring-2 focus:ring-blue-500"
        placeholder="Password"
        type="password"
        value={form.password}
        onChange={e => setForm({ ...form, password: e.target.value })}
        required
      />

      {/* row with remember + forgot */}
      <div className="flex items-center justify-between text-sm text-white/80">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-blue-600" />
          Remember me
        </label>
        <a href="#" className="hover:underline">
          Forgot password?
        </a>
      </div>

      <button
        className="w-full rounded-lg bg-blue-600 hover:bg-blue-700
                   text-white font-semibold py-3 shadow
                   disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Log In
      </button>

      {/* footnote */}
      <p className="text-xs text-white/60 text-center mt-8">
        © {new Date().getFullYear()} London Academy
      </p>
    </form>
  </div>
);
}
