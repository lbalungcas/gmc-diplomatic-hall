import { Link } from 'react-router-dom';
import { PublicShell } from '../components/PublicShell';

export default function NotFound() {
  return (
    <PublicShell>
      <div className="card p-6 text-center">
        <h1 className="text-2xl font-bold">Page not found</h1>
        <Link to="/" className="btn-primary mt-5">Go to registration</Link>
      </div>
    </PublicShell>
  );
}
