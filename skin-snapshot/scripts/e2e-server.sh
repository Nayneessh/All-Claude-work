#!/usr/bin/env bash
# Starts the production build with the end-to-end test configuration (mock AI, development sign-in, embedded database).
# Usage: npm run build:e2e && bash scripts/e2e-server.sh
export APP_ENV=test NODE_ENV=production AI_PROVIDER=mock AUTH_PROVIDER=dev BOTCHECK=off SIGNING_SECRET=e2e-signing-secret CRON_SECRET=e2e-cron \
  WHATSAPP_NUMBER=+919876500000 NEXT_PUBLIC_AUTH_MODE=dev TEST_BANNER=1 RETENTION_UNBOOKED_HOURS=24 NEXT_TELEMETRY_DISABLED=1 RATE_LIMIT_SCALE=100
exec npx next start -p "${PORT:-3100}"
