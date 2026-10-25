#!/usr/bin/env bash
# Static inspection of the shipped APK: package metadata, SDK levels, signature scheme + signer fingerprint, zip alignment.
# usage: inspect-apk.sh <dir with the release APK>   (optional file <dir>/signing-cert.sha256 = expected signer SHA-256)
set -euo pipefail
DIR="${1:?dir}"
BT="$(ls -d "${ANDROID_HOME:-/usr/local/lib/android/sdk}"/build-tools/* | sort -V | tail -1)"
APK="$(ls "$DIR"/*.apk | grep -vi debug | head -1)"
echo "APK: $APK ($(stat -c %s "$APK") bytes)"
echo "== aapt2 badging"; BADGE="$("$BT/aapt2" dump badging "$APK" | grep -E "^(package|sdkVersion|targetSdkVersion|application-label:|launchable-activity|uses-permission)")"; echo "$BADGE" | sed 's/^/  /'
echo "::notice title=APK badging::$(echo "$BADGE" | tr '\n' '|')"
echo "== apksigner verify"
"$BT/apksigner" verify --verbose --print-certs "$APK" | tee /tmp/apksigner.txt | sed 's/^/  /'
grep -q "Verified using v2 scheme (APK Signature Scheme v2): true" /tmp/apksigner.txt || grep -q "Verified using v3 scheme.*true" /tmp/apksigner.txt || { echo "no v2/v3 signature"; exit 1; }
GOT="$(grep -m1 'certificate SHA-256 digest' /tmp/apksigner.txt | awk '{print $NF}')"
echo "signer SHA-256: $GOT"
if [ -f "$DIR/signing-cert.sha256" ]; then
  WANT="$(tr -d ' \n:' < "$DIR/signing-cert.sha256" | tr 'A-F' 'a-f')"
  [ "$GOT" = "$WANT" ] || { echo "SIGNER MISMATCH: expected $WANT"; exit 1; }
  echo "signer matches the published fingerprint"
fi
echo "== zipalign"; "$BT/zipalign" -c -v 4 "$APK" | tail -2
echo "::notice title=APK checks::$(stat -c %s "$APK") bytes; signature verified (v2); signer SHA-256 $GOT; zipalign OK"
if [ -f "$DIR/SHA256SUMS" ]; then ( cd "$DIR" && sha256sum -c SHA256SUMS ); fi
