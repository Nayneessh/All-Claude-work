# Self-hosting image: the same app, no Vercel. Build:  docker build -t skin-snapshot .
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/copy-vision-assets.mjs scripts/
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG APP_ENV=production
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY APP_ENV=$APP_ENV NEXT_TELEMETRY_DISABLED=1
RUN node scripts/copy-vision-assets.mjs && npx next build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/.next .next
COPY --from=build /app/public public
COPY --from=build /app/next.config.ts ./
COPY --from=build /app/supabase supabase
COPY --from=build /app/scripts scripts
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
