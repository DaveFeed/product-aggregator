FROM node:20-slim AS web-builder

WORKDIR /web
COPY web/package*.json ./
RUN npm ci --legacy-peer-deps
COPY web/ ./
RUN npm run build


FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ curl procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

COPY . .
COPY --from=web-builder /web/dist ./web/dist

EXPOSE 3000
