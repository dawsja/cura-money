import { pgTable, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * OIDC providers the owner has wired up via the first-run wizard. The app
 * consumes these via Better Auth's `genericOAuth` plugin, registered at
 * boot from this table. client_secret is sensitive; encrypt at rest in
 * production deployments.
 */
export const oidcProviders = pgTable(
  'oidc_providers',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id').notNull().unique(), // e.g. "pocketid"
    discoveryUrl: text('discovery_url').notNull(),
    clientId: text('client_id').notNull(),
    clientSecret: text('client_secret').notNull(),
    scopes: text('scopes').array().notNull().default(['openid', 'email', 'profile']),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerIdx: index('idx_oidc_providers_provider').on(t.providerId),
  }),
);

export type OidcProviderRow = typeof oidcProviders.$inferSelect;
export type NewOidcProviderRow = typeof oidcProviders.$inferInsert;
