#!/usr/bin/env bash
# Signs the CI-built (unsigned) release APK with the permanent release key, verifies it independently, and writes the files
# that get published: the APK, SHA256SUMS and signing-cert.sha256 (the signer fingerprint users can compare).
#
#   scripts/android/release.sh <app-release-unsigned.apk> <app-debug.apk> <out-dir> <version>
#
# The key never leaves .release/ (git-ignored). Passwords are passed to the signer through the environment only and are never echoed.
set -euo pipefail
UNSIGNED="${1:?unsigned apk}"; DEBUG="${2:?debug apk}"; OUT="${3:?out dir}"; VER="${4:?version}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$ROOT/.release/signing.env" ] || { echo "missing .release/signing.env (see docs/ANDROID_RELEASE.md → key custody)"; exit 1; }
set -a; . "$ROOT/.release/signing.env"; set +a      # KEYSTORE_FILE, KEY_ALIAS, KEYSTORE_PASSWORD, KEY_PASSWORD
export MG_KEYSTORE_PASSWORD="$KEYSTORE_PASSWORD" MG_KEY_PASSWORD="$KEY_PASSWORD"
KS="$KEYSTORE_FILE"; [ -f "$KS" ] || KS="$ROOT/.release/$(basename "$KEYSTORE_FILE")"
TOOLS="${TOOLS_DIR:-$(mktemp -d)}"
APKSIG="$TOOLS/apksig.jar"
[ -f "$APKSIG" ] || curl -fsSL -o "$APKSIG" https://repo1.maven.org/maven2/com/android/tools/build/apksig/2.3.0/apksig-2.3.0.jar
[ -f "$TOOLS/classes/ApkSign.class" ] || { mkdir -p "$TOOLS/classes"; javac -cp "$APKSIG" -d "$TOOLS/classes" "$ROOT/scripts/android/ApkSign.java"; }
JAVA=(java --add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED --add-exports java.base/sun.security.util=ALL-UNNAMED -cp "$TOOLS/classes:$APKSIG" ApkSign)

mkdir -p "$OUT/test"
APK="$OUT/MonsterGains-$VER.apk"
"${JAVA[@]}" sign "$UNSIGNED" "$APK" "$KS" "$KEY_ALIAS"
echo "== independent verification (apksig)"; "${JAVA[@]}" verify "$APK"
cp "$DEBUG" "$OUT/test/MonsterGains-debug.apk"          # debuggable twin of the same bundle, used only by the emulator journey
FP="$(keytool -exportcert -rfc -alias "$KEY_ALIAS" -keystore "$KS" -storetype PKCS12 -storepass:env MG_KEYSTORE_PASSWORD | openssl x509 -noout -fingerprint -sha256 | sed 's/.*=//' | tr -d ':' | tr 'A-F' 'a-f')"
echo "$FP" > "$OUT/signing-cert.sha256"
( cd "$OUT" && sha256sum "MonsterGains-$VER.apk" > SHA256SUMS && cat SHA256SUMS )
echo "signer SHA-256: $FP"
