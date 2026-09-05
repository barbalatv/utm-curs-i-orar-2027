# syntax=docker/dockerfile:1.6
# ---- Stage 1: install dependencies & build the Next.js app (frontend + API) ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Keep the runtime COPY valid even when the app has no static public assets.
# The build does not need a database; the scheduler is started at runtime only.
RUN mkdir -p public && SCHEDULE_DISABLE_SCHEDULER=1 npm run build

# ---- Stage 2: minimal production runtime ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8000 \
    HOSTNAME=0.0.0.0 \
    SCHEDULE_DATA_DIR=/app/data
RUN groupadd --system app && useradd --system --gid app --home /app app
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/data/seed ./data/seed
RUN mkdir -p /app/data && chown -R app:app /app/data
USER app
VOLUME ["/app/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
