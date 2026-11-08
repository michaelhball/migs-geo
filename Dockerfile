FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4387 GEO_HOST=0.0.0.0 GEO_DATA_DIR=/data TZ=UTC
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY data/places.json ./data/places.json
COPY public/api.json ./public/api.json
RUN mkdir -p /data/backups && chown -R node:node /data
USER node
EXPOSE 4387
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(async r=>{const h=await r.json();if(!r.ok||!h.ok||h.database!=='ok')process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
