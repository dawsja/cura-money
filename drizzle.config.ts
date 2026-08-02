import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is required for drizzle-kit');
}

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  // Better Auth uses snake_case in the schema. We keep snake_case across
  // the whole project for Postgres-friendly column names.
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
