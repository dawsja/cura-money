import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '@/lib/env';

const url = env.DATABASE_URL;

// Pool tuning: small for self-host, max 10 connections. `prepare: false`
// disables Postgres prepared statements, which is required for some pgbouncer
// setups and reduces overhead for short-lived queries.
const client = postgres(url, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

// Lock holders must not consume the main query pool while their work uses it.
// A separate tiny pool prevents lock-bearing jobs from starving themselves.
const lockClient = postgres(url, {
  max: 2,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

export const db = drizzle(client, { schema });
export type Database = typeof db;

export type AdvisoryLockResult<T> = { acquired: false } | { acquired: true; value: T };

/** Run work while a dedicated PostgreSQL session owns an advisory lock. */
export async function withAdvisoryLock<T>(name: string, work: () => Promise<T>): Promise<AdvisoryLockResult<T>> {
  const connection = await lockClient.reserve();
  let acquired = false;
  try {
    const rows = await connection<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext('cura-money-lock'), hashtext(${name})) AS acquired
    `;
    acquired = rows[0]?.acquired === true;
    if (!acquired) return { acquired: false };
    return { acquired: true, value: await work() };
  } finally {
    try {
      if (acquired) {
        await connection`
          SELECT pg_advisory_unlock(hashtext('cura-money-lock'), hashtext(${name}))
        `;
      }
    } finally {
      connection.release();
    }
  }
}

/** Verify database availability without allowing readiness to hang. */
export async function checkDb(timeoutMs: number): Promise<void> {
  const query = client`SELECT 1`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      query,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          query.cancel();
          reject(new Error(`database readiness check timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Close the pool. Call from process exit handlers. */
export async function closeDb(): Promise<void> {
  await Promise.all([
    lockClient.end({ timeout: 5 }),
    client.end({ timeout: 5 }),
  ]);
}
