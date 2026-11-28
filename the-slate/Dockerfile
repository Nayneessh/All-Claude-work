# THE SLATE — container for any server (Docker, Kubernetes, a VPS behind your own domain).
# The app is a static single-page build: the only runtime is nginx. The backend stays Supabase (hosted or self-hosted).
#   docker build -t the-slate \
#     --build-arg VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co \
#     --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx .
#   docker run -p 8080:80 the-slate          # then put TLS (Caddy / nginx / a load balancer) in front for your domain
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_TIMEZONE=Asia/Kolkata
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY VITE_TIMEZONE=$VITE_TIMEZONE
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ | grep -q "THE SLATE" || exit 1
