import { useEffect, useRef, type ReactNode } from 'react';

/** Native <dialog>: focus trapping, Esc to close and the backdrop come for free. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      className={`m-auto w-[calc(100%-2rem)] rounded-2xl p-0 shadow-2xl backdrop:bg-slate-900/50 ${wide ? 'max-w-3xl' : 'max-w-md'}`}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h2 className="text-lg font-bold">{title}</h2>
        <button onClick={onClose} className="rounded-lg px-2 py-1 text-xl text-slate-500 hover:bg-slate-100" aria-label="Close">×</button>
      </div>
      <div className="max-h-[75dvh] overflow-y-auto p-5">{children}</div>
    </dialog>
  );
}
