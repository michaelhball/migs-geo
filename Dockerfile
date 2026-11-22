FROM node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS patched-node
RUN apt-get update \
    && apt-get -y upgrade \
    && rm -rf /var/lib/apt/lists/*

FROM patched-node AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM patched-node AS runtime
ENV NODE_ENV=production PORT=4387 GEO_HOST=0.0.0.0 GEO_DATA_DIR=/data TZ=UTC
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY data/places.json data/approved-facts.json ./data/
COPY public/api.json ./public/api.json
RUN mkdir -p /data/backups && chown -R node:node /data
USER node
EXPOSE 4387
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(async r=>{const h=await r.json();if(!r.ok||!h.ok||h.database!=='ok')process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
