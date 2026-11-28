'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function LearningHistoryDialog({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="learning-history-dialog"
      aria-label="Saved conversations and AI work"
      onCancel={onClose}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="learning-history-dialog-heading">
        <div>
          <h2>Saved work</h2>
          <p>Resume a conversation or review what your agent created.</p>
        </div>
        <button type="button" className="agent-pill" aria-label="Close history" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
