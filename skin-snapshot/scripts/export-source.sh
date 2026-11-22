#!/usr/bin/env bash
# Builds a complete, secret-free source package: everything needed to rebuild and deploy.
#   bash scripts/export-source.sh [output.zip]
# Uses git, so only tracked files are included (no node_modules, .next, .env, test output).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-skin-snapshot-source-$(date +%Y%m%d).zip}"
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT";; esac
ROOT="$(git rev-parse --show-toplevel)"
PREFIX="$(git rev-parse --show-prefix)"
# Refuse to package anything that looks like a live secret.
if git ls-files | xargs grep -IEl '(sb_secret_|service_role.{0,40}eyJ|sk-ant-[A-Za-z0-9_-]{20,}|-----BEGIN (RSA |EC )?PRIVATE KEY)' 2>/dev/null; then
  echo "A tracked file looks like it contains a secret. Remove it before exporting." >&2; exit 1
fi
git -C "$ROOT" archive --format=zip --prefix=skin-snapshot/ -o "$OUT" HEAD:"${PREFIX%/}"
# Include the large WASM runtime listing and reproduction notes
echo "Created $OUT ($(du -h "$OUT" | cut -f1))"
echo "Contents: source, migrations, docs, tests, deployment configuration. Secrets are never included."
echo "Rebuild:  unzip, cp .env.example .env.local, fill values, npm ci, npm run build"
