# Moneo API

REST API for personal finance management, built with **Hono**, **TypeScript**, **Sequelize** and **PostgreSQL**.

## Stack

- **Runtime**: Node.js 20+
- **Framework**: [Hono](https://hono.dev) + [@hono/zod-openapi](https://github.com/honojs/middleware/tree/main/packages/zod-openapi)
- **Database**: PostgreSQL via [Sequelize](https://sequelize.org)
- **Validation**: [Zod v4](https://zod.dev)
- **Auth**: JWT (access + refresh tokens) + Google OAuth
- **Storage**: Cloudflare R2 (avatars)
- **Logging**: [pino](https://getpino.io)
- **Tests**: [Vitest](https://vitest.dev)

## Setup local

### Prerequisites

- Node.js 20+
- pnpm
- Docker (for the database)

### 1. Start the database

```bash
docker compose up -d
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

## Environment variables

| Variable              | Description                              | Required |
|-----------------------|------------------------------------------|----------|
| `DATABASE_URL`        | PostgreSQL connection string             | Yes      |
| `ACCESS_TOKEN_SECRET` | Secret for signing access JWTs           | Yes      |
| `REFRESH_TOKEN_SECRET`| Secret for signing refresh JWTs          | Yes      |
| `GOOGLE_CLIENT_ID`    | Google OAuth client ID                   | No       |
| `R2_ACCOUNT_ID`       | Cloudflare R2 account ID                 | No       |
| `R2_ACCESS_KEY_ID`    | Cloudflare R2 access key                 | No       |
| `R2_SECRET_ACCESS_KEY`| Cloudflare R2 secret key                 | No       |
| `R2_BUCKET_NAME`      | Cloudflare R2 bucket name                | No       |
| `R2_PUBLIC_URL`       | Public URL for R2 assets                 | No       |
| `PORT`                | Server port (default: 3000)              | No       |
| `LOG_LEVEL`           | Pino log level (default: info)           | No       |
| `ALLOWED_ORIGINS`     | Comma-separated CORS origins (default: *)| No       |

## Commands

```bash
# Development (with hot reload)
pnpm dev

# Production build
pnpm build
pnpm start

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

## API Documentation

Once the server is running, open [http://localhost:3000/api-docs](http://localhost:3000/api-docs) for the Swagger UI.
