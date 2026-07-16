# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build \
  && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3080 \
    HOST=0.0.0.0

RUN addgroup -S daikin && adduser -S daikin -G daikin

COPY --from=build --chown=daikin:daikin /app/package.json /app/package-lock.json ./
COPY --from=build --chown=daikin:daikin /app/node_modules ./node_modules
COPY --from=build --chown=daikin:daikin /app/dist ./dist
COPY --from=build --chown=daikin:daikin /app/public ./public
COPY --chown=daikin:daikin config.example.json ./config.example.json

USER daikin
EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
