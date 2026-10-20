import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { publicUrl } from '../../lib/paths';
import { supabase } from '../../lib/supabase';

const MIN_PASSWORD = 10; // keep in step with Authentication → Providers → Email → minimum password length

/** Choose a password: after an invite or reset link, or from "Change password" while signed in. */
export default function SetPassword() {
  const { loading, session, role } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <div className="grid min-h-dvh place-items-center text-slate-500">Loading…</div>;
  if (!session) return <Navigate to="/admin/login" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    navigate(role === 'scanner' ? '/admin/scan' : role ? '/admin' : '/admin/login', { replace: true });
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-navy-surface px-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4 p-6">
        <img src={publicUrl('brand/logo.png')} alt="Youth Innovations Marketplace" className="h-12 w-auto" />
        <div>
          <h1 className="text-2xl font-bold">Choose a password</h1>
          <p className="mt-1 text-sm text-slate-600">
            For <strong>{session.user.email}</strong>. At least {MIN_PASSWORD} characters.
          </p>
        </div>
        <div>
          <label htmlFor="new-password" className="label">New password</label>
          <input id="new-password" type="password" required autoComplete="new-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label htmlFor="confirm-password" className="label">Type it again</label>
          <input id="confirm-password" type="password" required autoComplete="new-password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
        {role && (
          <button type="button" className="btn-ghost w-full" onClick={() => navigate(-1)}>Cancel</button>
        )}
      </form>
    </div>
  );
}
