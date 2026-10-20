import type { Status } from '../lib/types';

const STYLES: Record<Status, string> = {
  pending: 'bg-amber-100 text-amber-900 ring-amber-300',
  approved: 'bg-emerald-100 text-emerald-900 ring-emerald-300',
  declined: 'bg-red-100 text-red-900 ring-red-300',
  waitlisted: 'bg-sky-100 text-sky-900 ring-sky-300',
  cancelled: 'bg-slate-100 text-slate-700 ring-slate-300',
};

const LABELS: Record<Status, string> = {
  pending: 'Pending',
  approved: 'Approved',
  declined: 'Declined',
  waitlisted: 'Waitlisted',
  cancelled: 'Cancelled',
};

export const statusLabel = (s: Status) => LABELS[s];

export function StatusBadge({ status, checkedIn }: { status: Status; checkedIn?: boolean }) {
  if (checkedIn) {
    return <span className="inline-flex rounded-full bg-navy px-2.5 py-0.5 text-xs font-semibold text-white">Checked in</span>;
  }
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
