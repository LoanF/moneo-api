FROM node:22-alpine AS base
WORKDIR /usr/src/app
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS development
RUN pnpm install --frozen-lockfile
COPY . .
EXPOSE 3000 9229
CMD ["pnpm", "run", "dev"]

FROM base AS builder
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM base AS production
ENV NODE_ENV=production
RUN pnpm install --prod --frozen-lockfile && pnpm store prune
COPY --from=builder /usr/src/app/dist ./dist
COPY assets ./assets
COPY migrations ./migrations
COPY config ./config
COPY .sequelizerc ./.sequelizerc
# Le conteneur ne tourne pas en root.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1
# Les migrations sont appliquées avant le démarrage : l'API ne sert jamais un schéma périmé.
CMD ["sh", "-c", "node node_modules/sequelize-cli/lib/sequelize db:migrate && node dist/src/index.js"]
