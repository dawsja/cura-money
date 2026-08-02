/**
 * SimpleFIN poll: for every user with a stored access URL, sync.
 * Failures for one user do not stop the rest.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { settings } from '@/db/schema/settings';
import { syncSimpleFinToDatabase, type SimpleFinSyncResult } from '@/lib/simplefin';
import { logger } from '@/lib/logger';

export interface PollReport {
  usersAttempted: number;
  results: Array<{ userId: string; ok: boolean; result?: SimpleFinSyncResult; error?: string }>;
}

export async function runSimpleFinPollForAllUsers(): Promise<PollReport> {
  const rows = await db
    .select({ userId: settings.userId, value: settings.value })
    .from(settings)
    .where(eq(settings.key, 'simplefin_access_url'));

  const report: PollReport = { usersAttempted: 0, results: [] };
  for (const r of rows) {
    if (!r.value) continue;
    report.usersAttempted++;
    try {
      const result = await syncSimpleFinToDatabase(r.userId);
      report.results.push({ userId: r.userId, ok: true, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      logger.warn({ userId: r.userId, err: message }, 'simplefin-poll: user sync failed');
      report.results.push({ userId: r.userId, ok: false, error: message });
    }
  }
  return report;
}

// CLI entry for ad-hoc runs: bun run jobs/simplefin-poll <userId?>
if (import.meta.main) {
  const userIdArg = process.argv[2];
  runSimpleFinPollForAllUsers()
    .then((report) => {
      if (userIdArg) {
        const me = report.results.find((r) => r.userId === userIdArg);
        logger.info({ me }, 'simplefin-poll: result for user');
      } else {
        logger.info({ report }, 'simplefin-poll: all users');
      }
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err }, 'simplefin-poll: failed');
      process.exit(1);
    });
}

