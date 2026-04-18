# Moneo API

REST API for the Moneo personal finance app, built with **Hono**, **TypeScript**, **Sequelize** and **PostgreSQL**.

## Features

- **Authentication** — Email/password + Google OAuth, JWT access & refresh tokens, email verification, password reset
- **Finance management** — Bank accounts, transactions (income/expense/transfer), categories, payment methods, recurring payments
- **Realtime** — Server-Sent Events (SSE) to push live updates to connected clients
- **Push notifications** — Firebase Cloud Messaging (FCM) for mobile push; scheduled monthly recaps and activity reminders via cron
- **Email** — Transactional emails via Brevo SMTP (verification, password reset)
- **File storage** — Avatar uploads via Cloudflare R2 (S3-compatible)
- **Security** — Rate limiting on auth routes, Zod validation on all inputs, bcrypt password hashing
- **Documentation** — OpenAPI 3.1 spec auto-generated, Swagger UI served at `/api-docs`

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ |
| Framework | [Hono](https://hono.dev) + [@hono/zod-openapi](https://github.com/honojs/middleware/tree/main/packages/zod-openapi) |
| Database | PostgreSQL 15 via [Sequelize 6](https://sequelize.org) |
| Validation | [Zod v4](https://zod.dev) |
| Auth | JWT (access 5 min / refresh 7 days) + Google OAuth 2.0 |
| Push notifications | Firebase Admin SDK (FCM) |
| Email | Brevo SMTP via Nodemailer |
| Storage | Cloudflare R2 (AWS S3-compatible) |
| Scheduling | node-cron |
| Logging | [pino](https://getpino.io) |
| Tests | [Vitest](https://vitest.dev) |
| CI | GitHub Actions |

## Architecture

```
src/
├── config/          # Sequelize database connection
├── definitions/     # OpenAPI route definitions (Zod schemas → typed routes)
├── middleware/       # JWT auth guard, rate limiter
├── models/          # Sequelize ORM models (User, BankAccount, Transaction…)
├── routes/          # Route handlers (auth, transactions, accounts…)
├── schemas/         # Zod input/output schemas + unit tests
├── services/        # Business logic (FCM, email, cron jobs)
├── utils/           # Logger, password hashing, DB seeder
└── index.ts         # App entry point, Hono app setup
```

**Request flow:** `Hono router → Zod validation → Auth middleware → Route handler → Sequelize → PostgreSQL`

**Realtime flow:** `Sequelize model hooks → EventEmitter → SSE stream per user`

## Local setup

### Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- Docker + Docker Compose

### 1. Clone and install

```bash
git clone <repo-url>
cd moneo-api
pnpm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your values (see [Environment variables](#environment-variables) below).

### 3. Start the database

```bash
docker compose up -d postgres
```

### 4. Start the API

```bash
pnpm dev
```

The server starts on `http://localhost:3000`. Swagger UI is available at `http://localhost:3000/api-docs`.

> The schema is automatically synchronized on startup (`sequelize.sync({ alter: true })`). No manual migrations needed in development.

### Run with Docker (full stack)

```bash
docker compose up
```

This starts both PostgreSQL and the API in development mode with hot reload.

## Environment variables

| Variable | Description | Required |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `ACCESS_TOKEN_SECRET` | Secret for signing access JWTs (min 32 chars) | Yes |
| `REFRESH_TOKEN_SECRET` | Secret for signing refresh JWTs (min 32 chars) | Yes |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID | No |
| `BREVO_API_KEY` | Brevo API key for transactional emails | No |
| `SMTP_FROM` | Sender address for emails | No |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK JSON (single line) | No |
| `R2_ACCOUNT_ID` | Cloudflare R2 account ID | No |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 access key | No |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 secret key | No |
| `R2_BUCKET_NAME` | R2 bucket name | No |
| `R2_PUBLIC_URL` | Public base URL for R2 assets | No |
| `PORT` | Server port (default: `3000`) | No |
| `LOG_LEVEL` | Pino log level (default: `info`) | No |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins (default: `*`) | No |

> Email, push notifications, and file storage degrade gracefully when their respective variables are absent.

## API routes

All routes are prefixed with `/api/v1`. Authentication requires a `Bearer` token in the `Authorization` header.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Create account |
| POST | `/auth/login` | — | Sign in with email/password |
| POST | `/auth/google` | — | Sign in with Google ID token |
| POST | `/auth/refresh` | — | Refresh access token |
| POST | `/auth/logout` | Yes | Invalidate refresh token |
| GET | `/auth/me` | Yes | Get current user profile |
| PATCH | `/auth/me` | Yes | Update profile |
| DELETE | `/auth/me` | Yes | Delete account and all data |
| POST | `/auth/verify-email` | Yes | Confirm email with 6-digit code |
| POST | `/auth/resend-verification` | Yes | Resend verification email |
| POST | `/auth/forgot-password` | — | Request password reset |
| POST | `/auth/reset-password` | — | Reset password with code |
| GET | `/transactions` | Yes | List transactions (with filters) |
| POST | `/transactions` | Yes | Create transaction |
| PATCH | `/transactions/:id` | Yes | Update transaction |
| DELETE | `/transactions/:id` | Yes | Delete transaction |
| GET | `/bank-accounts` | Yes | List bank accounts |
| POST | `/bank-accounts` | Yes | Create bank account |
| PATCH | `/bank-accounts/:id` | Yes | Update bank account |
| DELETE | `/bank-accounts/:id` | Yes | Delete bank account |
| GET | `/categories` | Yes | List categories |
| POST | `/categories` | Yes | Create category |
| PATCH | `/categories/:id` | Yes | Update category |
| DELETE | `/categories/:id` | Yes | Delete category |
| GET | `/payment-methods` | Yes | List payment methods |
| POST | `/payment-methods` | Yes | Create payment method |
| PATCH | `/payment-methods/:id` | Yes | Update payment method |
| DELETE | `/payment-methods/:id` | Yes | Delete payment method |
| GET | `/monthly-payments` | Yes | List recurring payments |
| POST | `/monthly-payments` | Yes | Create recurring payment |
| PATCH | `/monthly-payments/:id` | Yes | Update recurring payment |
| DELETE | `/monthly-payments/:id` | Yes | Delete recurring payment |
| GET | `/realtime` | Yes | SSE stream for live updates |

Full request/response schemas are documented in the Swagger UI.

## Tests

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage report
pnpm test:coverage
```

Tests cover: Zod auth schemas, rate limiter middleware, password hashing, monthly payment processor.

## Deployment

### Build

```bash
pnpm build   # outputs to dist/
pnpm start   # runs dist/src/index.js
```

### Docker (production)

```bash
docker build --target production -t moneo-api .
docker run -p 3000:3000 --env-file .env moneo-api
```

The multi-stage Dockerfile produces a minimal production image with only compiled output and production dependencies.

### Database in production

Set `DATABASE_URL` to your managed PostgreSQL instance. The app runs `sequelize.sync({ alter: true })` on startup, which applies non-destructive schema changes automatically.

> For zero-downtime production deployments, replace `alter: true` with proper Sequelize migrations. 
