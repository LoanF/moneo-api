# --- Étape 1 : Dépendances et Build ---
FROM node:20-alpine AS builder
WORKDIR /usr/src/app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm run build

# --- Étape 2 : Production ---
FROM node:20-alpine
WORKDIR /usr/src/app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/package.json /usr/src/app/pnpm-lock.yaml ./

RUN pnpm install --prod --frozen-lockfile

EXPOSE 3000
CMD ["node", "dist/index.js"]