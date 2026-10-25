#!/usr/bin/env bash
# Runs inside the Android emulator (reactivecircus/android-emulator-runner).
# 1) install + launch the RELEASE apk (what users get): it must reach the foreground, stay alive and not crash,
#    also after being force-stopped and started again;
# 2) install the DEBUG build of the same web bundle and drive the real app through Android's WebView:
#    first launch -> log a set -> kill the process -> relaunch -> the logged set is still there.
set -euo pipefail
DIR="${1:?apk dir}"; PKG=com.monstergains.app; OUT=out; mkdir -p "$OUT"
REL="$(ls "$DIR"/*.apk | grep -vi debug | head -1)"; DBG="$(find "$DIR" -name '*debug*.apk' | head -1)"
shot() { adb exec-out screencap -p > "$OUT/$1.png"; }
crashes() { adb logcat -d | grep -E "FATAL EXCEPTION|ANR in $PKG|Process: $PKG.*died" || true; }
focused() { adb shell dumpsys window 2>/dev/null | tr -d '\r' | grep -E "mCurrentFocus|mFocusedApp" | head -3; }
wait_focus() { for _ in $(seq 1 45); do if focused | grep -q "$PKG"; then return 0; fi; sleep 1; done; return 1; }
launch() { adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null; }
alive() { [ -n "$(adb shell pidof "$PKG" | tr -d '\r')" ]; }

adb wait-for-device; adb shell input keyevent 82 || true
echo "::notice title=Emulator::Android $(adb shell getprop ro.build.version.release | tr -d '\r') (API $(adb shell getprop ro.build.version.sdk | tr -d '\r')), $(adb shell getprop ro.product.model | tr -d '\r')"

echo "== release: install + launch"
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
echo "::notice title=Release APK::installed, reached the foreground, process alive, no crash in logcat; relaunch after force-stop ok"
adb shell am force-stop "$PKG"; sleep 2
launch
wait_focus || { echo "release app did not come back after force-stop"; focused; crashes; exit 1; }
sleep 5
[ -z "$(crashes)" ] || { echo "CRASH on relaunch"; crashes; exit 1; }
alive || { echo "release app died after relaunch"; exit 1; }
echo "release relaunch ok"

if [ -z "$DBG" ]; then echo "no debug apk: skipping in-WebView journey"; exit 0; fi
echo "== debug: in-WebView journey"
adb uninstall "$PKG" >/dev/null 2>&1 || true
adb install -r "$DBG"
node scripts/android/cdp-journey.mjs "$OUT"
[ -z "$(crashes)" ] || { echo "CRASH during journey"; crashes; exit 1; }
echo "emulator verification passed"
echo "::notice title=WebView journey::onboarding -> quick workout -> set logged -> process killed -> relaunched -> data intact"
