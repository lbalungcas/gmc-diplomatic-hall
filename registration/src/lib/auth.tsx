import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from './supabase';

export type Role = 'admin' | 'scanner';

interface AuthState {
  loading: boolean;
  session: Session | null;
  role: Role | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({ loading: true, session: null, role: null, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load(s: Session | null) {
      setSession(s);
      if (!s) {
        setRole(null);
        setLoading(false);
        return;
      }
      // RLS lets a user read only their own admin_users row.
      const { data } = await supabase.from('admin_users').select('role, active').eq('user_id', s.user.id).maybeSingle();
      if (cancelled) return;
      setRole(data?.active ? (data.role as Role) : null);
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Defer: calling Supabase inside this callback can deadlock the auth lock.
      setTimeout(() => load(s), 0);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return <AuthContext.Provider value={{ loading, session, role, signOut }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/**
 * Client-side route guard. This is only UX — the real enforcement is RLS and the role checks
 * inside every RPC and Edge Function.
 */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { loading, session, role } = useAuth();
  const location = useLocation();

  if (loading) return <div className="grid min-h-dvh place-items-center text-slate-500">Loading…</div>;
  if (!session) return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  if (!role) return <Navigate to="/admin/login" replace state={{ denied: true }} />;
  if (!roles.includes(role)) return <Navigate to={role === 'scanner' ? '/admin/scan' : '/admin'} replace />;
  return <>{children}</>;
}
