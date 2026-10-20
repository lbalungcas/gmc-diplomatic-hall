import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { BASE } from './lib/paths';
import NotFound from './pages/NotFound';
import Register from './pages/Register';
import Registered from './pages/Registered';
import Ticket from './pages/Ticket';

// Staff pages (scanner, CSV, tables) load only when someone opens /register/admin.
const AdminApp = lazy(() => import('./AdminApp'));

export default function App() {
  return (
    <BrowserRouter basename={BASE.replace(/\/$/, '')}>
      <Suspense fallback={<div className="grid min-h-dvh place-items-center text-slate-500">Loading…</div>}>
        <Routes>
          <Route path="/" element={<Register />} />
          <Route path="/registered" element={<Registered />} />
          <Route path="/t/:token" element={<Ticket />} />
          <Route path="/admin/*" element={<AdminApp />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
