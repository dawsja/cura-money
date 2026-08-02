/**
 * In-process cron scheduler. Started by src/index.ts on app boot (gated by
 * the `RUN_CRON` env var, default true).
 *
 * Schedules are HARDCODED — operators cannot tune them. Rationale:
 *   - SIMPLEFIN_POLL_CRON respects SimpleFIN's documented <=24 requests/day
 *     quota. 12/day leaves headroom for the 3-call first-sync backfill
 *     and ad-hoc manual syncs.
 *   - BUDGET_ROLLFORWARD_CRON runs on the 1st of the month to roll
 *     budget carry-forwards forward before the user opens the app.
 *   - RETENTION_CRON runs daily at 04:00 UTC (after roll-forward) to
 *     purge data older than the start of the previous calendar year.
 *
 * Running cron in the same process is fine for a single-replica self-host
 * deployment. If you scale to multiple replicas, set `RUN_CRON=false` on all
 * but one and run that one with a dedicated container, or move the jobs to
 * an external scheduler (cron, k8s CronJob, etc).
 */
import cron from 'node-cron';
import { logger } from '@/lib/logger';
import { runSimpleFinPollForAllUsers } from './simplefin-poll';
import { runBudgetRollforward } from './budget-rollforward';
import { runRetention } from './retention';

// Hardcoded cron expressions — see file header for rationale.
const SIMPLEFIN_POLL_CRON = '0 */2 * * *'; // every 2 hours = 12 requests/day
const BUDGET_ROLLFORWARD_CRON = '0 0 1 * *'; // 1st of month, 00:00 UTC
const RETENTION_CRON = '0 4 * * *'; // daily, 04:00 UTC

export function startCron(): void {
  logger.info(
    { simplefin: SIMPLEFIN_POLL_CRON, rollforward: BUDGET_ROLLFORWARD_CRON, retention: RETENTION_CRON },
    'cron: starting',
  );

  if (!cron.validate(SIMPLEFIN_POLL_CRON)) {
    throw new Error(`invalid SIMPLEFIN_POLL_CRON: ${SIMPLEFIN_POLL_CRON}`);
  }
  if (!cron.validate(BUDGET_ROLLFORWARD_CRON)) {
    throw new Error(`invalid BUDGET_ROLLFORWARD_CRON: ${BUDGET_ROLLFORWARD_CRON}`);
  }
  if (!cron.validate(RETENTION_CRON)) {
    throw new Error(`invalid RETENTION_CRON: ${RETENTION_CRON}`);
  }

  cron.schedule(SIMPLEFIN_POLL_CRON, async () => {
    logger.info('cron: simplefin-poll tick');
    try {
      const result = await runSimpleFinPollForAllUsers();
      logger.info({ result }, 'cron: simplefin-poll done');
    } catch (err) {
      logger.error({ err }, 'cron: simplefin-poll failed');
    }
  });

  cron.schedule(BUDGET_ROLLFORWARD_CRON, async () => {
    logger.info('cron: budget-rollforward tick');
    try {
      const result = await runBudgetRollforward();
      logger.info({ result }, 'cron: budget-rollforward done');
    } catch (err) {
      logger.error({ err }, 'cron: budget-rollforward failed');
    }
  });

  cron.schedule(RETENTION_CRON, async () => {
    logger.info('cron: retention tick');
    try {
      const result = await runRetention();
      logger.info({ result }, 'cron: retention done');
    } catch (err) {
      logger.error({ err }, 'cron: retention failed');
    }
  });

  logger.info('cron: scheduled');
}

// Allow running just the cron entrypoint for ad-hoc local use
// (`bun run src/jobs/cron.ts`). Not used in the default compose.
if (import.meta.main) {
  startCron();
}
