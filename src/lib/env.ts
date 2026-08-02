/**
 * Centralised, validated environment loader. Imported everywhere we need config
 * so we crash loudly on boot if anything required is missing or malformed.
 *
 * Design note: this app is built to be self-hostable behind any reverse proxy
 * (Caddy, nginx, Traefik, Cloudflare Tunnel, plain port-forward, …). The URL
 * env vars below are therefore all OPTIONAL. If unset, the app derives the
 * effective origin from the incoming request's `Host` + `X-Forwarded-Proto`
 * headers. Set them only when you want a stable URL across all requests —
 * typically when running behind a domain-fronting proxy.
 */
import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // External-facing URL of the app. Empty → derive per-request from headers.
  // Set this when you want OIDC callbacks and self-references to always use
  // a stable domain (e.g. https://cura.zerd.cc). Leave empty for raw-IP dev
  // or when the public hostname is the same as the request's Host header.
  APP_URL: z.string().default(''),

  // Better Auth's self-reference. Same semantics as APP_URL — leave empty to
  // derive from the request. If you do set it, it must match what the user
  // types in the browser (or what the proxy forwards as Host).
  BETTER_AUTH_URL: z.string().default(''),

  // Redirect base sent to OIDC providers as the post-login callback. Defaults
  // to the request origin (or BETTER_AUTH_URL if set). Set this explicitly
  // when your reverse proxy rewrites the host.
  OIDC_REDIRECT_BASE: z.string().default(''),

  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 chars'),

  // Disable the in-process cron scheduler (SimpleFIN poll + budget roll-
  // forward + retention sweep). Default false (cron runs). Set true if you
  // run the cron in a separate process / external scheduler and want to
  // avoid double-execution. The cron schedules themselves are HARDCODED
  // in src/jobs/cron.ts — see that file for rationale.
  RUN_CRON: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0'), z.literal('')])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
});

export type Env = z.infer<typeof Env>;

function loadEnv(): Env {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    console.error('[env] invalid environment:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment; see logs above');
  }
  return parsed.data;
}

export const env = loadEnv();

/**
 * Resolve the effective external origin for a given request.
 * Priority: env override (APP_URL / BETTER_AUTH_URL) → request headers.
 * The result is the scheme + host (no trailing slash, no path).
 */
export function resolveOrigin(request: Request, fallback: 'app' | 'auth' | 'oidc' = 'app'): string {
  const configured =
    fallback === 'app' ? env.APP_URL : fallback === 'auth' ? env.BETTER_AUTH_URL : env.OIDC_REDIRECT_BASE;
  if (configured && configured.length > 0) {
    try {
      const u = new URL(configured);
      return `${u.protocol}//${u.host}`;
    } catch {
      // fall through to header-based resolution
    }
  }
  const host = request.headers.get('host') ?? request.headers.get('x-forwarded-host') ?? 'localhost:3000';
  const proto =
    request.headers.get('x-forwarded-proto') ??
    (host.startsWith('localhost') || host.startsWith('127.') || host.startsWith('192.168.') ? 'http' : 'https');
  return `${proto}://${host}`;
}
