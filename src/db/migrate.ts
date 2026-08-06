/**
 * Standalone migration runner. Idempotent.
 *
 * Runs from:
 *   - `bun run db:migrate` (dev, CLI)
 *   - `src/index.ts` on app startup (production)
 *
 * The migrator tracks applied migrations in the `__drizzle_migrations` table
 * inside the same database. Re-running is safe.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * One-time data migration that has to run AFTER drizzle's migrate()
 * returns, in a fresh transaction. We add the 'transfer' enum value in
 * 0007, but Postgres won't let a transaction reference a new enum
 * value that the same transaction added — and drizzle's migrate() runs
 * every file in one transaction, so we have to wait until it commits
 * before doing the reclassification.
 *
 * NOTE: the actual reclassification has already been applied (run
 * manually via psql during the development of this feature, while we
 * worked through several iterations of the heuristic). The function
 * here now just verifies the data is in the expected state and seeds
 * the Transfer category for any user who's missing it. New
 * transactions are classified by the smart categoriser at insert time
 * (`src/lib/categorize.ts`) and via the inline 3-way type column on
 * the Transactions page, so no further data fixup is needed.
 *
 * What this function does:
 *   1. Idempotently insert a "Transfer" main category (with one
 *      "Account Transfer" sub) for any user that doesn't have one.
 *   2. Sanity-check: count transactions with the new transfer type
 *      so we can see in the logs that the migration ran.
 */
async function applyTransferMigration(client: postgres.Sql): Promise<void> {
  // 1. Seed the Transfer category for every user who doesn't have one.
  // sort_order = 9999 puts it at the bottom — the user can drag it.
  await client.unsafe(`
    DO $$
    DECLARE
      uid TEXT;
      main_id TEXT;
      sub_id TEXT;
      inserted_count INTEGER := 0;
    BEGIN
      FOR uid IN
        SELECT u.id
        FROM "user" u
        WHERE EXISTS (
          SELECT 1 FROM settings s
          WHERE s.user_id = u.id AND s.key = 'initial_categories_seeded'
        )
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM categories
          WHERE user_id = uid AND name = 'Transfer' AND type = 'transfer'
        ) THEN
          main_id := uid || '__cat-transfer';
          sub_id := uid || '__sub-account-transfer';
          INSERT INTO categories (id, user_id, name, type, icon, sort_order, created_at)
          VALUES (main_id, uid, 'Transfer', 'transfer', 'ArrowLeftRight', 9999, NOW())
          ON CONFLICT (id) DO NOTHING;
          INSERT INTO sub_categories (id, user_id, main_category_id, name, planned, created_at)
          VALUES (sub_id, uid, main_id, 'Account Transfer', 0, NOW())
          ON CONFLICT (id) DO NOTHING;
          inserted_count := inserted_count + 1;
        END IF;
      END LOOP;
      RAISE NOTICE 'applyTransferMigration: inserted Transfer category for % users', inserted_count;
    END $$;
  `);

  // 2. Sanity log: count of each transaction type, so we can see in
  //    the boot logs whether the reclassification actually persisted.
  const counts = await client.unsafe(`
    SELECT type::text AS type, COUNT(*)::int AS n
    FROM transactions
    GROUP BY type
    ORDER BY type
  `);
  logger.info({ counts }, 'applyTransferMigration: transaction type distribution');
}

/** Apply all pending migrations + the post-migration data fixup. */
export async function runMigrations(): Promise<void> {
  const url = env.DATABASE_URL;
  const client = postgres(url, { max: 1, prepare: false });
  try {
    logger.info('migrate: applying migrations...');
    const start = Date.now();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: './drizzle' });
    logger.info({ ms: Date.now() - start }, 'migrate: drizzle migrations done');

    // Run the data migration in a fresh transaction (drizzle's migrate()
    // has already returned, so its outer transaction is committed and the
    // 'transfer' enum value is visible).
    await applyTransferMigration(client);
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate] failed:', err);
      process.exit(1);
    });
}
