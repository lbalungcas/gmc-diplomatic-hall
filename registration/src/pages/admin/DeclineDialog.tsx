import { useState } from 'react';
import { Modal } from '../../components/Modal';

export function DeclineDialog({ count, onCancel, onConfirm }: { count: number; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={`Decline ${count} registration${count === 1 ? '' : 's'}`} onClose={onCancel}>
      <label htmlFor="decline-reason" className="label">Reason (optional — included in the email)</label>
      <textarea id="decline-reason" rows={3} maxLength={500} className="input" value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. We have reached capacity for this participant group." />
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn-danger" onClick={() => onConfirm(reason.trim())}>Decline and email</button>
      </div>
    </Modal>
  );
}
