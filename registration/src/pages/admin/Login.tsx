import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { BASE, publicUrl } from '../../lib/paths';
import { authLinkError, supabase } from '../../lib/supabase';

export default function Login() {
  const { loading, session, role, signOut } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [mode, setMode] = useState<'password' | 'reset' | 'reset-sent'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(
    authLinkError ? `${authLinkError}. Ask an admin for a new invite, or use "Forgot password".` : null,
  );
  const [busy, setBusy] = useState(false);

  if (!loading && session && role) {
    return <Navigate to={from ?? (role === 'scanner' ? '/admin/scan' : '/admin')} replace />;
  }

  async function onSignIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.status === 400 ? 'Wrong email or password.' : error.message);
  }

  async function onReset(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}${BASE}admin/password`,
    });
    setBusy(false);
    // Same message whether or not the address exists, so this can't be used to probe for staff emails.
    if (error && error.status !== 400 && error.status !== 422) setError(error.message);
    else setMode('reset-sent');
  }

  const switchTo = (m: 'password' | 'reset') => {
    setMode(m);
    setError(null);
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-navy-surface px-4">
      <div className="card w-full max-w-sm p-6">
        <img src={publicUrl('brand/logo.png')} alt="Youth Innovations Marketplace" className="mb-5 h-12 w-auto" />
        <h1 className="text-2xl font-bold">{mode === 'password' ? 'Staff sign-in' : 'Reset password'}</h1>

        {session && !role && !loading ? (
          <div className="mt-4 space-y-4">
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
              <strong>{session.user.email}</strong> doesn't have registration access. Ask an admin to add you.
            </p>
            <button className="btn-ghost w-full" onClick={signOut}>Sign out</button>
          </div>
        ) : mode === 'reset-sent' ? (
          <div className="mt-4 space-y-4">
            <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
              If <strong>{email}</strong> is a staff account, a link to set a new password is on its way.
            </p>
            <button className="btn-ghost w-full" onClick={() => switchTo('password')}>Back to sign-in</button>
          </div>
        ) : (
          <form onSubmit={mode === 'password' ? onSignIn : onReset} className="mt-4 space-y-4">
            <div>
              <label htmlFor="email" className="label">Email</label>
              <input id="email" type="email" required autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {mode === 'password' && (
              <div>
                <label htmlFor="password" className="label">Password</label>
                <input id="password" type="password" required autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            )}
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <button className="btn-primary w-full" disabled={busy}>
              {mode === 'password' ? (busy ? 'Signing in…' : 'Sign in') : busy ? 'Sending…' : 'Email me a reset link'}
            </button>
            <p className="text-center text-sm">
              <button type="button" className="font-semibold text-navy underline" onClick={() => switchTo(mode === 'password' ? 'reset' : 'password')}>
                {mode === 'password' ? 'Forgot password?' : 'Back to sign-in'}
              </button>
            </p>
          </form>
        )}
        <p className="mt-6 text-center text-xs text-slate-500">You stay signed in on this device until you sign out.</p>
      </div>
    </div>
  );
}
