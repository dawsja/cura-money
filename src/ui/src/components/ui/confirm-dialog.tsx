import { useId, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { Button } from './button';
import { Dialog } from './dialog';

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
  destructive?: boolean;
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
  destructive = false,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const confirm = async () => {
    setPending(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The operation could not be completed.');
      setPending(false);
    }
  };

  return (
    <Dialog
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={pending}
      initialFocusRef={cancelRef}
      closeDisabled={pending}
      onClose={onClose}
      overlayClassName="dialog-overlay--dim"
      contentClassName="w-full max-w-md rounded-xl border border-default bg-surface p-5 shadow-2xl"
    >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold fg-primary">{title}</h2>
            <div id={descriptionId} className="mt-2 space-y-2 text-sm fg-secondary">
              {children}
            </div>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} type="button" variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending}
            onClick={confirm}
          >
            {pending && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </div>
    </Dialog>
  );
}
