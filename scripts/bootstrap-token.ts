#!/usr/bin/env bun
/**
 * Break-glass CLI: re-issue a setup bootstrap token.
 *
 * Use only when:
 *   - setup_state.bootstrap_completed is FALSE, AND
 *   - no admin user exists.
 *
 * Otherwise the operation refuses (use sign-in for normal recovery).
 *
 * Usage (inside the `app` container):
 *   docker compose exec app bun run scripts/bootstrap-token.ts
 */
import { issueBootstrapToken } from '../src/auth/setup';
import { logger } from '../src/lib/logger';

async function main(): Promise<void> {
  try {
    const token = await issueBootstrapToken();
    // Print loud — this is the one operator who will copy it.
    console.log('================================================================');
    console.log('  NEW SETUP BOOTSTRAP TOKEN (1h expiry)');
    console.log(`  ${token}`);
    console.log('================================================================');
    console.log('Use this in the /setup wizard to bootstrap the first admin.');
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    logger.error({ err: message }, 'bootstrap-token: refused');
    console.error(`[bootstrap-token] refused: ${message}`);
    process.exit(1);
  }
}

main();
