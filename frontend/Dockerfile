# Popsicle's website, for self-hosting with Docker (see compose.yaml and README.md → "Self-hosting
# with Docker"). Built as Next.js's small standalone server, so the final image has no node_modules.

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-slim AS build
WORKDIR /app
# Where the website forwards /api: the backend service on the compose network. Next.js fixes its
# forwarding when it builds, so this is a build argument rather than a runtime setting.
ARG BACKEND_ORIGIN=http://backend:8000
ENV BACKEND_ORIGIN=${BACKEND_ORIGIN} \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
# PROXY_SECRET is read when the server runs (src/proxy.ts), so it comes from compose, never the image.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Owned by the app's user so Next.js can cache optimized company logos in .next/cache.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
