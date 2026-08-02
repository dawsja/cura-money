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

export const db = drizzle(client, { schema });
export type Database = typeof db;

/** Close the pool. Call from process exit handlers. */
export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}
