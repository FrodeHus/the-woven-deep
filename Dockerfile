FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY compose.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY content ./content
COPY docs ./docs
COPY scripts ./scripts
RUN npm ci
RUN npm test && npm run typecheck && npm run build && npm run engine:demo && npm run dungeon:demo && npm run gameplay:demo && npm run population:demo && npm run merchant:demo
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 \
    DATABASE_PATH=/data/rogue.sqlite CONTENT_DIR=/app/content \
    WEB_DIST_DIR=/app/apps/web/dist
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages/content/package.json ./packages/content/package.json
COPY --from=build /app/packages/content/dist ./packages/content/dist
COPY --from=build /app/packages/engine/package.json ./packages/engine/package.json
COPY --from=build /app/packages/engine/dist ./packages/engine/dist
COPY --from=build /app/content ./content
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "apps/server/dist/main.js"]
