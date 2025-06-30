import { createContext, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';

const AuthContext = createContext<{ session: Session | null }>({ session: null });
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    // ── async IIFE so we can await ──────────────────────
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) =>
      setSession(s)
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ session }}>
      {children}
    </AuthContext.Provider>
  );
}
