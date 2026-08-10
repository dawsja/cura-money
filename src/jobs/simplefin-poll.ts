/**
 * SimpleFIN poll: for every user with a stored access URL, sync.
 * Failures for one user do not stop the rest.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { settings } from '@/db/schema/settings';
import { publicSimpleFinError, syncSimpleFinToDatabase } from '@/lib/simplefin';
import { setSetting } from '@/db/queries';
import { logger } from '@/lib/logger';

export interface PollReport {
  usersAttempted: number;
  usersSucceeded: number;
  usersFailed: number;
  usersSkipped: number;
  accountsSynced: number;
  transactionsSynced: number;
}

export async function runSimpleFinPollForAllUsers(): Promise<PollReport> {
  const rows = await db
    .select({ userId: settings.userId, value: settings.value })
    .from(settings)
    .where(eq(settings.key, 'simplefin_access_url'));

  const report: PollReport = {
    usersAttempted: 0,
    usersSucceeded: 0,
    usersFailed: 0,
    usersSkipped: 0,
    accountsSynced: 0,
    transactionsSynced: 0,
  };
  for (const r of rows) {
    if (!r.value) continue;
    report.usersAttempted++;
    try {
      const result = await syncSimpleFinToDatabase(r.userId);
      report.accountsSynced += result.accountsSynced;
      report.transactionsSynced += result.transactionsSynced;
      if (result.errors.length > 0) {
        report.usersFailed++;
        logger.warn({ errorCount: result.errors.length }, 'simplefin-poll: provider reported sync errors');
      } else {
        report.usersSucceeded++;
      }
    } catch (err) {
      const failure = publicSimpleFinError(err);
      await setSetting(r.userId, 'simplefin_last_error', failure.message);
      if (failure.code === 'sync_in_progress') report.usersSkipped++;
      else report.usersFailed++;
      logger.warn({ code: failure.code }, 'simplefin-poll: user sync failed');
    }
  }
  return report;
}

// CLI entry for ad-hoc runs: bun run jobs:simplefin
if (import.meta.main) {
  runSimpleFinPollForAllUsers()
    .then((report) => {
      logger.info({ report }, 'simplefin-poll: all users');
      process.exit(0);
    })
    .catch((err) => {
      const failure = publicSimpleFinError(err);
      logger.error({ code: failure.code }, 'simplefin-poll: failed');
      process.exit(1);
    });
}
