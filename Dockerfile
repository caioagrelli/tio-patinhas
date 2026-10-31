FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build

FROM build AS test
CMD ["npm", "run", "test:coverage"]

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/web-dist ./web-dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && exec node dist/server/src/main.js"]
