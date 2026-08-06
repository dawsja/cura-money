import { env } from './env';

export interface RetentionPolicy {
  enabled: boolean;
  days: number;
  cutoffDate: string | null;
  cutoffYearMonth: string | null;
}

/** Single source of truth for cleanup, report bounds, and API disclosure. */
export function retentionPolicy(now: Date = new Date()): RetentionPolicy {
  if (env.RETENTION_DAYS === 0) {
    return { enabled: false, days: 0, cutoffDate: null, cutoffYearMonth: null };
  }

  const cutoff = new Date(now);
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - env.RETENTION_DAYS);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  return {
    enabled: true,
    days: env.RETENTION_DAYS,
    cutoffDate,
    cutoffYearMonth: cutoffDate.slice(0, 7),
  };
}
