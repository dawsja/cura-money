import { AlertCircle, RefreshCw } from 'lucide-react';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

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
    <Alert variant={loading ? 'default' : 'destructive'} className={className}>
      {loading ? <Spinner /> : <AlertCircle />}
      <AlertTitle>{title}</AlertTitle>
      {message ? <AlertDescription>{message}</AlertDescription> : null}
      {!loading && onRetry ? (
        <AlertAction>
          <Button type="button" size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
            {retrying ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
            {retrying ? 'Retrying…' : 'Retry'}
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}
