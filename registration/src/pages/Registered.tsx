import { Link } from 'react-router-dom';
import { PublicShell } from '../components/PublicShell';

export default function Registered() {
  return (
    <PublicShell>
      <div className="card p-6 text-center">
        <h1 className="text-2xl font-bold">Thank you — check your email</h1>
        <p className="mt-2">We've received your registration and sent a confirmation email with a link to check your status.</p>
        <Link to="/" className="btn-ghost mt-5">Back to registration</Link>
      </div>
    </PublicShell>
  );
}
