FROM node:20-alpine AS base
WORKDIR /usr/src/app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install

FROM base AS development
COPY . .
EXPOSE 3000 9229
CMD ["pnpm", "run", "dev"]

FROM base AS builder
COPY . .
RUN pnpm run build

FROM node:20-alpine AS production
WORKDIR /usr/src/app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/package.json /usr/src/app/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
EXPOSE 3000
CMD ["node", "dist/index.js"]