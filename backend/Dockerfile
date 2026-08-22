FROM node:22-bookworm-slim AS development-dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM development-dependencies AS build

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS production-dependencies

ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json package-lock.json ./
RUN chmod -R a-w /app

USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
