# Cura Money

Self-hostable personal finance. Accounts, categories, monthly budgets,
transactions, debt paydown calculator.

## Quick start

Prereqs: Docker and Docker Compose.

```bash
cp .env.example .env
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" >> .env
docker compose up -d
docker compose logs app | grep "SETUP BOOTSTRAP"
```

Open http://localhost:3000, paste the token, run through the setup guide. Done.

The pre-built image is pulled from GHCR.
Published by GitHub Actions on every push to `main` and every `v*` tag.

## Updating

```bash
docker compose down && docker compose up -d --pull always
```

## Configuration

All via `.env`. Required:

- `BETTER_AUTH_SECRET` — random base64, at least 32 bytes
- `POSTGRES_PASSWORD` — Postgres password

Set only when behind a domain:

- `APP_URL` / `BETTER_AUTH_URL` / `OIDC_REDIRECT_BASE`

See `.env.example` for the full list. Cron schedules, SimpleFIN, log
level, and port are all there with defaults.

## Features

- Accounts: checking, savings, credit, investment, loan
- Categories with monthly planned budgets and forward carry-forward
- Transactions: manual entry, smart merchant categorisation, filters
- Debt paydown calculator: avalanche, snowball, planned
- Optional SimpleFIN bank sync (cron-driven, every 30 minutes by default)
- OIDC sign-in with any OpenID Connect IdP

## License

MIT. See [`LICENSE`](./LICENSE).
 
 
