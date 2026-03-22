# ── Mobile PWA Dockerfile ───────────────────────────────────────
# Multi-stage: build React PWA → serve via nginx
# ─────────────────────────────────────────────────────────────────

FROM node:20-alpine AS builder
WORKDIR /app
ARG VITE_API_URL=https://api.addxintelligence.com
ENV VITE_API_URL=$VITE_API_URL
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
ENV PORT=80
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
