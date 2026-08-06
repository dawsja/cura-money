import { pgTable, integer, boolean, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Setup state — single-row table that tracks the first-run wizard progress.
 *
 * The middleware in src/lib/guard.ts reads this on every request to decide
 * whether to 307 to /setup. The bootstrap token hash is bcrypt; the plain
 * token is printed to container logs ONCE on first boot and stored nowhere
 * plaintext after that.
 */
export const setupState = pgTable('setup_state', {
  // Single row, id is always 1
  id: integer('id').primaryKey().default(1),
  needsAdmin: boolean('needs_admin').notNull().default(true),
  oidcConfigured: boolean('oidc_configured').notNull().default(false),
  bootstrapCompleted: boolean('bootstrap_completed').notNull().default(false),
  bootstrapTokenHash: text('bootstrap_token_hash'),
  bootstrapTokenExpiresAt: timestamp('bootstrap_token_expires_at', { withTimezone: true }),
  // When TRUE, email/password sign-in + change-password
  // endpoints return 403 and the sign-in page hides the local-auth
  // form. Admins can only flip this after at least one OIDC user has
  // been promoted to admin (see `canDisableLocalAuth()` in
  // src/auth/local_auth.ts). Defaults to FALSE so a fresh install
  // never blocks its first admin out.
  localAuthDisabled: boolean('local_auth_disabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SetupStateRow = typeof setupState.$inferSelect;
export type NewSetupStateRow = typeof setupState.$inferInsert;
