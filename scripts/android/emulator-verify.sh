#!/usr/bin/env bash
# Runs inside the Android emulator (reactivecircus/android-emulator-runner).
# 1) install + launch the RELEASE apk (what users get) and make sure it starts without crashing;
# 2) install the DEBUG build of the same web bundle and drive the real app through Android's WebView over DevTools:
#    first launch -> start workout -> log sets -> kill the process -> relaunch -> the logged sets are still there.
set -euo pipefail
DIR="${1:?apk dir}"; PKG=com.monstergains.app; OUT=out; mkdir -p "$OUT"
REL="$(ls "$DIR"/*.apk | grep -vi debug | head -1)"; DBG="$(find "$DIR" -name '*debug*.apk' | head -1)"
shot() { adb exec-out screencap -p > "$OUT/$1.png"; }
crashes() { adb logcat -d | grep -E "FATAL EXCEPTION|ANR in $PKG|Process: $PKG.*died" || true; }

adb wait-for-device; adb shell input keyevent 82 || true
echo "== release: install + launch"
adb uninstall "$PKG" >/dev/null 2>&1 || true
adb install -r "$REL"
adb shell pm list packages | grep -q "$PKG"
adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 10
shot 01-release-launch
adb shell uiautomator dump /sdcard/ui.xml >/dev/null; adb pull /sdcard/ui.xml "$OUT/ui-release-launch.xml" >/dev/null
if [ -n "$(crashes)" ]; then echo "CRASH after release launch"; crashes; exit 1; fi
grep -qiE "monster|next|skip|today|start" "$OUT/ui-release-launch.xml" || { echo "release app showed no recognisable UI"; exit 1; }
echo "release launched, no crash, UI present"
adb shell am force-stop "$PKG"; sleep 2
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null; sleep 6
[ -z "$(crashes)" ] || { echo "CRASH on relaunch"; crashes; exit 1; }
echo "release relaunch ok"

if [ -z "$DBG" ]; then echo "no debug apk: skipping in-WebView journey"; exit 0; fi
echo "== debug: in-WebView journey over DevTools"
adb uninstall "$PKG" >/dev/null 2>&1 || true
adb install -r "$DBG"
node scripts/android/cdp-journey.mjs "$OUT"
[ -z "$(crashes)" ] || { echo "CRASH during journey"; crashes; exit 1; }
echo "emulator verification passed"
