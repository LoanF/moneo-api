# Moneo API

<div align="center">

<img src="https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white"  alt="node" />
<img src="https://img.shields.io/badge/Hono-000?logo=hono&logoColor=FF7233"  alt="hono" />
<img src="https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white"  alt="typescript" />
<img src="https://img.shields.io/badge/PostgreSQL-336791?logo=postgresql&logoColor=white"  alt="postgresql" />
<img src="https://img.shields.io/badge/Sequelize-52B0E7?logo=sequelize&logoColor=white"  alt="sequelize" />

[![CI/CD Status](https://github.com/LoanF/moneo-api/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/LoanF/moneo-api/actions/workflows/ci-cd.yml)
![Latest Release](https://img.shields.io/github/v/release/LoanF/moneo-api?label=version&color=blue)
[![Codecov](https://codecov.io/github/LoanF/moneo-api/graph/badge.svg?token=QBYZ2AZSLY)](https://codecov.io/github/LoanF/moneo-api)
![License](https://img.shields.io/github/license/LoanF/moneo-api)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg)](https://conventionalcommits.org)
[![Status](https://status.moneo-app.com/api/badge/2/status)](https://status.moneo-app.com)

**REST API for the Moneo personal finance app** *Built with Hono, TypeScript, Sequelize and PostgreSQL*

</div>

## Features

- **Accounts with computed balances** — balances are never stored: remaining, checked ("pointé") and as-of-today balances are derived from the opening balance and the entries, so they cannot drift
- **Transactions** — income, expense, paired transfers (two mirrored legs sharing a `transferId`), reconciliation ("pointage"), advanced filters, entry suggestions, idempotent creation for offline clients
- **Recurring payments** — per-month amount overrides, catch-up of missed months, three modes (whole month up front, on due date, manual)
- **Chequebooks** — automatic cheque numbering, number released when the last cheque is cancelled
- **Budgets & insights** — category budgets with alerts, period summary, monthly trend, daily balance history, 30-day forecast, pivot table (period → category → subcategory)
- **Notifications** — in-app notification centre + FCM push on every device, quiet hours, low balance, budget, upcoming payment, monthly recap
- **Import / export** — imports the `Comptes.xlsm` tracking workbook, JSON backup/restore, CSV export
- **Authentication** — email/password + Google, per-device sessions with rotating opaque refresh tokens (reuse detection), hashed one-time codes, rate limiting per IP and per account
- **Realtime** — Server-Sent Events telling clients what changed
- **Documentation** — OpenAPI 3.1 generated from the Zod schemas, Swagger UI at `/api-docs` (non-production, or `ENABLE_API_DOCS=true`)

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20.10+ (image: Node 22) |
| Framework | [Hono](https://hono.dev) + [@hono/zod-openapi](https://github.com/honojs/middleware/tree/main/packages/zod-openapi) |
| Database | PostgreSQL 15 (UTF-8) via [Sequelize 6](https://sequelize.org), schema managed by migrations only |
| Validation | [Zod v4](https://zod.dev) |
| Auth | Access JWT (15 min) + opaque refresh token (60-day sliding session, SHA-256 at rest) |
| Passwords | scrypt (`node:crypto`) |
| Push / email / storage | Firebase Admin (FCM) · Brevo HTTP API · Cloudflare R2 |
| Scheduling | node-cron (in the app timezone) |
| Tests | [Vitest](https://vitest.dev) against a real PostgreSQL |

## Architecture

```
src/
├── config/        # Validated environment (fail fast), Sequelize connection, Sentry
├── db/models.ts   # All Sequelize models and associations
├── lib/           # Dates, money, tokens, passwords, errors, events, HTTP helpers
├── middleware/    # Bearer auth, rate limiter, security headers
├── routes/        # OpenAPI route declarations + thin handlers
├── services/      # Business logic: balances, transactions, recurring, stats,
│                  # notifications, importer, jobs
├── app.ts         # Hono app assembly (testable, no side effects)
└── index.ts       # Process entry point: server, cron jobs, graceful shutdown
migrations/        # Single v2 baseline migration
test/              # Integration tests (HTTP → PostgreSQL)
```

**Request flow:** `Hono → rate limit → Zod validation → auth → handler → service → PostgreSQL`

**Realtime flow:** `service → publish(userId, event) → SSE stream` — events carry what changed (`model`, `type`, `id`, `origin`), clients refetch what they display.

### Design rules

- **Money** is `NUMERIC(15,2)`; amounts are signed (negative = money out). The sign is enforced server-side from the transaction type.
- **Dates** of transactions are calendar dates (`YYYY-MM-DD`), never timestamps: no timezone drift.
- **Ownership** of every referenced object (account, category, payment method, chequebook) is checked on every write.
- **Idempotency**: creation endpoints accept a client-generated `id`; replaying returns `200` with the existing object, and an `id` owned by someone else returns `409` without leaking anything.
- **Soft delete** on transactions (`deletedAt`) enables incremental sync via `GET /transactions?updatedSince=`; the bin is purged after 90 days.

## Local setup

Prerequisites: Node.js 20.10+, pnpm, Docker.

```bash
pnpm install
cp .env.example .env          # then fill in the values
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

This starts PostgreSQL (published on `localhost:5432`) and the API with hot reload; migrations are applied on start. Swagger UI: `http://localhost:3000/api-docs`.

To run the API outside Docker against that database: set `DB_HOST=localhost`, then `pnpm migrate && pnpm dev`.

## Environment variables

| Variable | Description | Required |
|---|---|---|
| `ACCESS_TOKEN_SECRET` | JWT signing secret — **32+ characters in production**, otherwise the API refuses to start | Yes |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `DB_HOST` / `DB_PORT` | Database connection | Yes (or `DATABASE_URL`) |
| `DATABASE_URL` | Connection string, replaces the variables above | No |
| `DB_SSL` | `true` for a managed database requiring TLS | No |
| `ALLOWED_ORIGINS` | Comma-separated browser origins for CORS. Empty = none (the mobile app needs none) | No |
| `TRUST_PROXY` | `true` **only** behind a reverse proxy writing `X-Forwarded-For`; required there for per-IP rate limiting | No |
| `APP_TIMEZONE` | Timezone for "today", cron jobs and quiet hours (default `Europe/Paris`) | No |
| `PUBLIC_API_URL` | Server URL advertised in the OpenAPI document | No |
| `ENABLE_API_DOCS` | `true` to expose Swagger UI in production | No |
| `GOOGLE_CLIENT_ID` | Enables Google sign-in | No |
| `BREVO_API_KEY`, `SMTP_FROM` | Verification and password-reset emails | No |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin JSON (single line) for push | No |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` | Avatar storage | No |
| `UPTIME_PUSH_URL`, `SENTRY_DSN`, `LOG_LEVEL`, `PORT` | Monitoring and runtime | No |

Email, push and file storage degrade gracefully when their variables are absent.

## API overview

All routes are under `/api/v1` and, except the public auth routes, require `Authorization: Bearer <access token>`. The exhaustive, always up-to-date reference is the OpenAPI document (`/api/v1/openapi.json`).

| Area | Routes |
|---|---|
| Auth | `POST /auth/register` · `login` · `google` · `refresh` · `forgot-password` · `reset-password` · `logout` · `logout-all` · `change-password` · `verify-email` · `resend-verification` |
| Profile | `GET/PATCH/DELETE /auth/me` · `POST/DELETE /auth/me/avatar` · `GET /auth/sessions` · `DELETE /auth/sessions/{id}` · `PUT /auth/device` |
| Bootstrap | `GET /bootstrap` — everything the app needs at launch, in one round trip |
| Accounts | `GET/POST /accounts` · `PATCH/DELETE /accounts/{id}` · `PUT /accounts/order` |
| Catalogue | CRUD on `/categories` (+ `/order`), `/payment-methods`, `/chequebooks` |
| Transactions | `GET/POST /transactions` · `GET/PATCH/DELETE /transactions/{id}` · `POST /transactions/transfers` · `/batch` · `/check` · `GET /transactions/suggestions` |
| Recurring | CRUD on `/recurring-payments` · `GET /recurring-payments/pending` · `POST /recurring-payments/run` |
| Budgets | CRUD on `/budgets` (list includes progress and projection) |
| Stats | `GET /stats/summary` · `monthly` · `balance-history` · `forecast` · `pivot` |
| Notifications | `GET/DELETE /notifications` · `POST /notifications/read` · `DELETE /notifications/{id}` |
| Data | `POST /data/import/comptes` (multipart `file`) · `POST /data/import/json` · `GET /data/export?format=json\|csv` |
| Realtime | `GET /realtime` (SSE) |

Errors are always `{ "error": "<message for the user>", "code": "<machine code>" }`.

## Tests

```bash
pnpm test            # unit + integration
pnpm test:coverage   # thresholds: 70 % lines/functions, 55 % branches
pnpm typecheck
```

Integration tests drive the real HTTP app against a real PostgreSQL whose schema is created by the migration itself (so the migration is tested too, including `down` → `up`):

- locally, an embedded PostgreSQL is started for the run — nothing to install;
- in CI, `TEST_DATABASE_URL` points at the workflow's `postgres` service.

Covered: authentication and session rotation, isolation between users, computed balances, transfers, chequebooks, filters, recurring generation and catch-up, statistics, budgets and alerts, workbook import and export round trip.

## Deployment

```bash
cp .env.example .env   # fill in the values
docker compose up -d --build
```

- The container applies pending migrations, then starts the API as a non-root user. `GET /health` returns `200` when the database is reachable, `503` otherwise; the image declares it as its health check.
- PostgreSQL is not published on the host in the base compose file.
- The in-memory rate limiter and the SSE event bus assume **a single API instance**. Running several replicas requires moving both to a shared store (Redis) first.

### Upgrading from v1

The v2 baseline migration **drops the v1 tables**: no data is carried over. Export anything you need beforehand, then re-import your history through `POST /data/import/comptes` or `/data/import/json`. `REFRESH_TOKEN_SECRET` is no longer used.
