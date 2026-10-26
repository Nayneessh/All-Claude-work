#!/usr/bin/env bash
# Runs inside the Android emulator (reactivecircus/android-emulator-runner).
# 1) RELEASE apk (what users get): installs, reaches the foreground, stays alive, no crash — also after a force-stop;
# 2) DEBUG twin of the same bundle, driven inside Android's real WebView: log a set → kill the process → relaunch → data intact;
# 3) real soft keyboard + real touch: typing in sheets and set rows must never lose focus or flicker the keyboard;
# 4) update in place: old build → log data → install the new build over it → the data is still there.
set -euo pipefail
DIR="${1:?apk dir}"; UPG="${2:-}"; PKG=com.monstergains.app; OUT=out; mkdir -p "$OUT"
REL="$(ls "$DIR"/MonsterGains-*.apk | grep -vi debug | sort -V | tail -1)"; DBG="$DIR/test/MonsterGains-debug.apk"
shot() { adb exec-out screencap -p > "$OUT/$1.png"; }
crashes() { adb logcat -d | grep -E "FATAL EXCEPTION|ANR in $PKG|Process: $PKG.*died" || true; }
focused() { adb shell dumpsys window 2>/dev/null | tr -d '\r' | grep -E "mCurrentFocus|mFocusedApp" | head -3; }
wait_focus() { for _ in $(seq 1 45); do if focused | grep -q "$PKG"; then return 0; fi; sleep 1; done; return 1; }
launch() { adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null; }
alive() { [ -n "$(adb shell pidof "$PKG" | tr -d '\r')" ]; }

adb wait-for-device; adb shell input keyevent 82 || true
API="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
echo "::notice title=Emulator::Android $(adb shell getprop ro.build.version.release | tr -d '\r') (API $API), $(adb shell getprop ro.product.model | tr -d '\r')"

echo "== 1. release: install + launch ($REL)"
adb uninstall "$PKG" >/dev/null 2>&1 || true
adb install -r "$REL"
adb shell pm list packages | grep -q "$PKG"
adb logcat -c
launch
wait_focus || { echo "release app never reached the foreground"; focused; crashes; exit 1; }
sleep 8
shot 01-release-launch
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
adb pull /sdcard/ui.xml "$OUT/ui-release-launch.xml" >/dev/null 2>&1 || true
echo "foreground: $(focused | tr '\n' ' ')"
echo "visible texts: $(grep -o 'text="[^"]*"' "$OUT/ui-release-launch.xml" 2>/dev/null | grep -v 'text=""' | head -12 | tr '\n' ' ')"
if [ -n "$(crashes)" ]; then echo "CRASH after release launch"; crashes; exit 1; fi
alive || { echo "release app process is not running"; exit 1; }
echo "release launched, in the foreground, process alive, no crash"
adb shell am force-stop "$PKG"; sleep 2
launch
wait_focus || { echo "release app did not come back after force-stop"; focused; crashes; exit 1; }
sleep 5
[ -z "$(crashes)" ] || { echo "CRASH on relaunch"; crashes; exit 1; }
alive || { echo "release app died after relaunch"; exit 1; }
echo "release relaunch ok"
echo "::notice title=Release APK (API $API)::installed, reached the foreground, process alive, no crash in logcat; relaunch after force-stop ok"

if [ ! -f "$DBG" ]; then echo "no debug twin: skipping the in-WebView checks"; exit 0; fi

echo "== 2. debug twin: log a set, kill the process, relaunch"
adb uninstall "$PKG" >/dev/null 2>&1 || true
adb install -r "$DBG"
node scripts/android/cdp-journey.mjs "$OUT" full
[ -z "$(crashes)" ] || { echo "CRASH during journey"; crashes; exit 1; }
echo "::notice title=WebView journey (API $API)::onboarding -> quick workout -> set logged -> process killed -> relaunched -> data intact"

echo "== 3. real soft keyboard + touch: typing must not lose focus or flicker the keyboard"
node scripts/android/cdp-journey.mjs "$OUT" keyboard
echo "::notice title=Keyboard (API $API)::typing in the exercise search, a set row and a sheet field kept focus; no keyboard flicker"

if [ -n "$UPG" ] && [ -f "$UPG/old-debug.apk" ] && [ -f "$UPG/new-debug.apk" ]; then
  echo "== 4. update in place: old build -> data -> new build over it"
  adb uninstall "$PKG" >/dev/null 2>&1 || true
  adb install -r "$UPG/old-debug.apk"
  node scripts/android/cdp-journey.mjs "$OUT" seed
  adb shell am force-stop "$PKG"; sleep 2
  adb install -r "$UPG/new-debug.apk"
  node scripts/android/cdp-journey.mjs "$OUT" verify
  [ -z "$(crashes)" ] || { echo "CRASH during the update check"; crashes; exit 1; }
  echo "::notice title=Update in place (API $API)::old build + logged set -> new build installed over it -> logged set still there"
else
  echo "no old/new pair provided: skipping the update-in-place check"
fi
echo "emulator verification passed"
