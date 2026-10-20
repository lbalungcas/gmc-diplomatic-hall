import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../lib/auth';

export default function AdminLayout() {
  const { role, session, signOut } = useAuth();
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? 'bg-white/15 text-white' : 'text-white/75 hover:text-white'}`;

  return (
    <div className="min-h-dvh">
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
          <span className="font-display text-lg font-bold">YIM Registration</span>
          <nav className="flex flex-1 flex-wrap gap-1">
            {role === 'admin' && <NavLink to="/admin" end className={link}>Registrants</NavLink>}
            <NavLink to="/admin/checkin" className={link}>Manual check-in</NavLink>
            <NavLink to="/admin/scan" className={link}>Scanner</NavLink>
            {role === 'admin' && <NavLink to="/admin/form" className={link}>Form</NavLink>}
            {role === 'admin' && <NavLink to="/admin/settings" className={link}>Settings</NavLink>}
          </nav>
          <span className="hidden text-xs text-white/70 sm:inline">{session?.user.email} · {role}</span>
          <NavLink to="/admin/password" className="text-xs font-semibold text-white/75 hover:text-white">Change password</NavLink>
          <button onClick={signOut} className="rounded-lg border border-white/30 px-3 py-1.5 text-xs font-semibold hover:bg-white/10">
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
