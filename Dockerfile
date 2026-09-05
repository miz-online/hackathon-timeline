# Self-hosted variant: builds the app for the Node server target and runs it
# with a SQLite database plus uploaded files on a mounted volume at /data.

FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY . .
ENV BACKEND=local
ENV NITRO_PRESET=node-server
RUN bun run build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV BACKEND=local
ENV DATA_DIR=/data
ENV PORT=3000
COPY --from=build /app/.output ./.output
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh && mkdir -p /data
VOLUME ["/data"]
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
