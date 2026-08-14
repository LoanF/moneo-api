FROM node:26-alpine AS base
WORKDIR /usr/src/app
RUN npm config set strict-ssl false
RUN npm install -g pnpm@10.18.0
COPY package.json pnpm-lock.yaml ./
RUN npm config set strict-ssl false
RUN pnpm install

FROM base AS development
COPY . .
EXPOSE 3000 9229
CMD ["pnpm", "run", "dev"]

FROM base AS builder
COPY . .
RUN pnpm run build

FROM node:26-alpine AS production
WORKDIR /usr/src/app
RUN npm install -g pnpm@10.18.0
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/assets ./assets
COPY --from=builder /usr/src/app/migrations ./migrations
COPY --from=builder /usr/src/app/config ./config
COPY --from=builder /usr/src/app/.sequelizerc ./.sequelizerc
COPY --from=builder /usr/src/app/package.json /usr/src/app/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
EXPOSE 3000
CMD ["node", "dist/src/index.js"]