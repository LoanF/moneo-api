# --- Étape 1 : Dépendances et Build ---
FROM node:20-alpine AS builder
WORKDIR /usr/src/app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm run build

RUN pnpm prune --prod

# --- Étape 2 : Production ---
FROM node:20-alpine
WORKDIR /usr/src/app

RUN corepack enable

COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/package.json ./

EXPOSE 3000
CMD ["node", "dist/index.js"]