# --- Étape 1 : Dépendances et Build ---
FROM node:20-alpine AS builder
WORKDIR /usr/src/app

RUN npm install -g pnpm

COPY pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm run build

# --- Étape 2 : Production ---
FROM node:20-alpine
WORKDIR /usr/src/app

RUN npm install -g pnpm

COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/pnpm-lock.yaml ./

RUN pnpm install --prod --frozen-lockfile

EXPOSE 3000
CMD ["pnpm", "start"]