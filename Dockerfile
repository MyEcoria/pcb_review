# syntax=docker/dockerfile:1

FROM node:20-alpine AS build
WORKDIR /app/web

COPY web/package.json web/bun.lock ./
RUN npm install --no-audit --no-fund

COPY web/ .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/healthz || exit 1
