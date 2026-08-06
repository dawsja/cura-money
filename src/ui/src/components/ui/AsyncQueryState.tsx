import { AlertCircle, RefreshCw } from 'lucide-react';
import clsx from 'clsx';

interface AsyncQueryStateProps {
  status: 'loading' | 'error';
  title: string;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}

export function AsyncQueryState({
  status,
  title,
  message,
  onRetry,
  retrying = false,
  className,
}: AsyncQueryStateProps) {
  const loading = status === 'loading';

  return (
    <div
      className={clsx('card flex items-start gap-3 text-sm', className)}
      role={loading ? 'status' : 'alert'}
      aria-live="polite"
    >
      {loading ? (
        <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin fg-muted" />
      ) : (
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
      )}
      <div className="min-w-0 space-y-1">
        <p className="font-semibold fg-primary">{title}</p>
        {message && <p className="fg-muted">{message}</p>}
        {!loading && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="mt-1 inline-flex min-h-9 items-center gap-1.5 rounded-md border border-default px-3 text-xs font-medium fg-primary hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-700"
          >
            <RefreshCw className={clsx('h-3.5 w-3.5', retrying && 'animate-spin')} />
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        )}
      </div>
    </div>
  );
}
