# AGENTS.md — Cura Money

## Theme and palette

Before touching any color, brand mark, or visual surface, read
[`THEME.md`](./THEME.md). It documents the three-surface palette
system (main canvas, secondary canvas, overlay) plus the GitHub-flavored
accents, how Tailwind scales map to it, the non-monotonic dark-mode
scale shape, and the procedure for a full palette swap. All token edits
live in `src/ui/src/styles.css` — never change palette values inside
component `.tsx` files.

## Packages and entrypoints

- Bun 1.3+ repository with two independently installed packages and lockfiles: the Hono API at the root and the React/Vite SPA in `src/ui/`.
- Server entrypoint: `src/index.ts`. Startup order is migration → setup bootstrap → auth initialization → retention sweep → optional cron → HTTP server; preserve this ordering.
- UI entrypoint/router: `src/ui/src/App.tsx`. Vite outputs directly to root `public/`; `public/index.html` and `public/assets/` are generated. Branding sources are `src/ui/public/logo.png` and `src/ui/public/logo.ico`.
- Production runs `bun run src/index.ts` from a shell-less distroless image; it does not use root `dist/`. The app process serves the API, baked SPA, and cron jobs.
- `docker-compose.yml` pulls the published image. Source development requires both files: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`. `docker-compose.override.yml` is an inert deprecated stub.

## Setup and verification

```bash
bun install --frozen-lockfile
(cd src/ui && bun install --frozen-lockfile)

bun run lint                       # server/scripts only; UI and generated auth schema are ignored
bun run typecheck                  # root TS only; tsconfig excludes src/ui
(cd src/ui && bun run build)       # UI typecheck followed by Vite production build
```

- Run all three checks after changes. There is currently no automated test framework or test suite; do not invent a test command.
- Focused UI typechecking is `cd src/ui && bun run tsc --noEmit`; focused server verification is `bun run typecheck`.
- Smoke-test a running stack with `curl -s http://localhost:3000/health` and `curl -s http://localhost:3000/api/setup/status`.
- Host UI development: `bun run dev:web`; Vite proxies `/api` to `localhost:3000`. With the dev Compose stack, `bun run build:ui` writes into the bind-mounted `public/`; hard-refresh to pick up new hashed assets.

## Data and migrations

- All application data access belongs in `src/db/queries.ts`. Every user-owned query/write must take `userId` and filter by `user_id`; route handlers obtain it with `userId(c)` from `src/lib/tenant.ts`.
- Validate request bodies, environment, and external JSON with Zod. Logs are structured Pino objects; never log credentials. Extend `src/lib/logger.ts` redaction if adding a secret field.
- Schema workflow is `bun run db:generate` then `bun run db:migrate` (requires `DATABASE_URL`). Generation first rewrites committed `src/db/schema/auth.ts` via Better Auth, then creates a Drizzle migration. Do not hand-edit that generated auth schema or an existing migration; migrations are forward-only. `db:push` is development-only, never production.
- PostgreSQL enum additions may require post-migration work in a fresh transaction: `src/db/migrate.ts` deliberately runs `applyTransferMigration()` after Drizzle migrations because a newly added enum value cannot be used in the same migration transaction.

## Routing, auth, and static files

- Better Auth exclusively owns `/api/auth/*`; app helpers live under `/api/auth-app/*`. `src/lib/guard.ts` protects resource routes after public setup/auth routes are mounted.
- New resource endpoints need a Zod-validating router in `src/routes/`, a user-scoped query helper, and mounting in `src/index.ts`.
- Keep the custom static middleware in `src/index.ts`; Hono's `serveStatic({ root })` mishandles top-level files here. Add every new unauthenticated static path to `PUBLIC_PREFIXES` in `src/lib/guard.ts`.
- OIDC providers are hot-reloaded through `refreshAuth()` in `src/auth/instance.ts`; admin/setup mutations must call it rather than request a restart.
- Sign-out in `src/routes/auth.ts` manually expires Better Auth session cookies. Do not re-enable `session.cookieCache` or remove those `Set-Cookie` headers without retesting Hono response propagation.
- Never hardcode a domain. Origin resolution is `APP_URL` → request `Host`/`X-Forwarded-Proto` → localhost fallback; reverse proxies must forward those headers.

## Domain invariants

- `transfer` is a transaction type and is excluded from income/expense totals. Categorization rules take precedence over `smartCategorizeMerchant`; preserve rule matching during manual entry, inline edits, and SimpleFIN imports.
- Hidden SimpleFIN accounts must be checked before upsert/import so synchronization cannot recreate their visible data. Account aliases are read-time display overrides and must not be overwritten during sync.
- Retention keeps the current and previous calendar years. It runs on boot and daily; report `all` ranges use the same lower bound.
- Cron schedules and SimpleFIN windows are constants, not operator settings: polling every 2 hours, 6-month initial lookback in 60-day chunks, and a 1-day incremental overlap. `RUN_CRON` is the only cron environment switch; disable it on all but one replica.
- The setup wizard is the only bootstrap path. `bun run bootstrap:token` / `scripts/bootstrap-token.ts` works only while no admin exists.

## UI constraints

- Base palette styling uses semantic utilities from `src/ui/src/styles.css`: `fg-*`, `bg-page`, `bg-surface`, `bg-canvas-subtle`, and `border-default`. Do not scatter light/dark slate pairs.
- Brand palette is **GitHub Dark surfaces + green-themed muted GitHub Light** — light-mode page is muted off-white (`#e9eef2`) with `#dde4ea` secondary canvas and `#f6f8fa` lifted overlay cards (no pure white anywhere on screen — avoids "flash bang" on large monitors); dark-mode page is `#0d1117` with `#161b22` secondary canvas and `#21262d` overlay. The full token table lives in `src/ui/src/styles.css`. The five core colors are:
  - Background `#0d1117` (dark) / `#e9eef2` (light)
  - Overlay `#21262d` (dark) / `#f6f8fa` (light)
  - Primary text `#c9d1d9` (dark) / `#1f2328` (light)
  - CTA green `#22c55e` (both modes — vivid fresh green, Tailwind green-500)
  - Accent purple `#d2a8ff` (dark) / `#8250df` (light)
  - (Plus success green, danger red, warning yellow from GitHub Primer — see THEME.md for the full table.)
- Amber is the brand CTA slot (per the rule below), so the `amber-*` Tailwind scale maps to the green CTA family here (not stock GitHub blue — distinguishes the brand). Emerald uses a related but distinct green family for success (`#1a7f37` light / `#3fb950` dark). Rose/sky/violet carry their usual semantic meanings (danger / warning / depth) using GitHub Primer's red/yellow/purple. Slate is a consistent cool-neutral ramp shared by both modes so `dark:text-slate-100` patterns stay readable. The Tailwind theme in `styles.css` wires every utility through CSS variables that swap per mode — change a token there, not in component files.
- Amber buttons use dark text, never `text-white`. The green CTA (`#22c55e` in both modes) is medium-saturation; white fails AA contrast on it, but `--mp-slate-900` (`#0d1117`) passes ~6.6:1 in light mode and the same value against the lifted dark CTA passes ~7.2:1. `text-slate-900` (or another dark fg token) is the correct pairing. Verify any new amber-button pattern keeps dark text. Preserve WCAG AA contrast when changing tokens — light text needs ≥4.5:1 against its bg, dark text needs the same.
- Follow existing mobile-first, viewport-locked layouts: only `<main>` scrolls. Interactive controls need visible hover/focus/active states and roughly 44px mobile targets; use targeted transitions, never `transition-all`.
- Hierarchical category selects use one `<select>` with `<optgroup>` and JSON-encoded option values; reuse the implementation in `src/ui/src/pages/Transactions.tsx` rather than delimiter parsing.

## Operations

- Production migrations run automatically at container boot. Update only the app with `docker compose pull app && docker compose up -d app`.
- The default stack is exactly `db`, `redis`, and `app`; reverse proxy and OIDC provider are operator choices. Use the named PostgreSQL volume, especially on Windows.
- Runtime images have no shell. Operational scripts such as backup run from the host; do not design runtime procedures around `sh` inside the app container.
