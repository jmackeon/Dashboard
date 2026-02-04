import { supabase } from "./supabaseClient";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

export function requireApiBase() {
  if (!API_BASE) throw new Error("Missing VITE_API_BASE_URL in frontend env");
  return API_BASE;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = requireApiBase();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const headers = new Headers(init?.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && init?.body) headers.set("Content-Type", "application/json");

  const res = await fetch(`${base}${path}`, { ...init, headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}
