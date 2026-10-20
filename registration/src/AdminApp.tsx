import { lazy, useEffect } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { AuthProvider, RequireRole, useAuth } from './lib/auth';
import { authLinkType } from './lib/supabase';
import NotFound from './pages/NotFound';

const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const Login = lazy(() => import('./pages/admin/Login'));
const SetPassword = lazy(() => import('./pages/admin/SetPassword'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const CheckIn = lazy(() => import('./pages/admin/CheckIn'));
const Scan = lazy(() => import('./pages/admin/Scan'));
const Settings = lazy(() => import('./pages/admin/Settings'));
const FormEditor = lazy(() => import('./pages/admin/FormEditor'));

let pendingPasswordSetup = authLinkType === 'invite' || authLinkType === 'recovery';

/** Invite and password-reset links sign the user in wherever they land; send them to choose a password first. */
function PasswordSetupRedirect() {
  const { loading, session } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (pendingPasswordSetup && !loading && session) {
      pendingPasswordSetup = false;
      navigate('/admin/password', { replace: true });
    }
  }, [loading, session, navigate]);
  return null;
}

/** Everything under /admin. Mounted at /admin/* by App. */
export default function AdminApp() {
  return (
    <AuthProvider>
      <PasswordSetupRedirect />
      <Routes>
        <Route path="login" element={<Login />} />
        <Route path="password" element={<SetPassword />} />
        <Route path="scan" element={<RequireRole roles={['admin', 'scanner']}><Scan /></RequireRole>} />
        <Route element={<RequireRole roles={['admin', 'scanner']}><AdminLayout /></RequireRole>}>
          <Route index element={<RequireRole roles={['admin']}><Dashboard /></RequireRole>} />
          <Route path="checkin" element={<CheckIn />} />
          <Route path="form" element={<RequireRole roles={['admin']}><FormEditor /></RequireRole>} />
          <Route path="settings" element={<RequireRole roles={['admin']}><Settings /></RequireRole>} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  );
}
