# Android release

## Download and install

| | |
| --- | --- |
| **Direct download** | https://github.com/Nayneessh/All-Claude-work/raw/release/MonsterGains-1.0.0.apk |
| Mirror | https://raw.githubusercontent.com/Nayneessh/All-Claude-work/release/MonsterGains-1.0.0.apk |
| Size / SHA-256 | 5,467,992 bytes · `fef729717054685e34dbade30fb3a80027bc1636ebb79235711aa60e7f194e64` |
| Signer certificate SHA-256 | `2fff1f48500b4bcc5407d5c5a8c8af5cacf07d564ab08d4045f06c978ea90e15` (CN=Monster Gains, RSA-4096, SHA256withRSA, valid 2026-10-25 → 2056-10-17) |
| Package · version | `com.monstergains.app` · 1.0.0 (versionCode = CI run number, strictly increasing) |
| Requirements | Android 7.0+ (minSdk 24); built for Android 16 (target/compile SDK 36) |
| Source of this build | commit `03dfbd6` (recorded in `SOURCE_SHA` on the `release` branch), GitHub Actions run 14 |

The URL was fetched after publication: HTTP 200, same byte count, same SHA-256 as the signed file.

**Install:** open the link on the phone → allow *Install unknown apps* for the browser/Files app once → open the file → *Install*. First launch shows three short screens, then *Start training*.
**Verify (optional):** `sha256sum -c SHA256SUMS` (in the `release` branch) and `apksigner verify --print-certs MonsterGains-1.0.0.apk` — the printed certificate SHA-256 must equal the value above.
**Update later:** install the next APK over this one. It must be signed with the **same key**, otherwise Android refuses the update (see key custody). Never uninstall first — uninstalling erases the on-device database (your cloud copy/backups remain, but avoid the detour).

## How a release is produced

1. Push to the repository → `Android build` workflow: `npm ci` → `npm run build` → `cap sync` → Gradle `assembleRelease assembleDebug` on a GitHub runner (JDK 21, SDK 36 platform + build-tools). Output: `app-release-unsigned.apk`, `app-debug.apk`, published as a workflow artifact and to the single-commit `ci-artifacts` branch.
2. `scripts/android/release.sh <unsigned> <debug> <out> <version>` signs the unsigned APK with the release key (Android's own **apksig** library, APK Signature Scheme v2 — supported from Android 7.0), re-verifies it with apksig, writes `SHA256SUMS` and `signing-cert.sha256`.
3. The signed APK + metadata are pushed to the `release` branch (no force-push, new branch).
4. `Android verify (emulator)` workflow (manual dispatch, input `apk_branch=release`): `aapt2 dump badging`, `apksigner verify --print-certs` against the published fingerprint, `zipalign -c`, then an Android 14 emulator: install → launch → UI present, no crash → force-stop → relaunch; then the debuggable twin of the same bundle is driven through Android's real WebView over DevTools: first launch → start workout → log a set → **kill the process** → relaunch → the set is still there.

If the repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` are set, the Gradle build signs in CI itself (same key) and step 2 becomes unnecessary.

## Key custody — read this

The release key lives only in the project working directory `.release/` of the machine that built this release (git-ignored, mode 600; never committed, never printed). **If it is lost, no future update can be installed over this version** (Android compares signer certificates). Your data is not lost in that case (sync / export / snapshots), but you would have to install fresh and restore.
Recommended: copy `.release/` to a password manager or an encrypted drive now, and optionally add the four GitHub secrets above so CI can sign without this machine. The agent that built this release can hand the key file to you on request; it is intentionally not attached to this repository or to the chat.

## Supabase setup (backend for sync)

* Project: `monster-gains` (ref `dteecymrdbtqnlwzvfjn`, region ap-south-1, Postgres 17), created for this app. Public values in `.env.production`: project URL and the **publishable** key only.
* Migrations (in order): `supabase/migrations/20261025000001_core_schema.sql`, then `…000002_seed_exercise_library.sql`. **Status: Applied to the live project on 2026-10-26 (owner ran the combined `monster-gains-supabase-setup.sql` in the SQL Editor — the MCP `apply_migration` confirmation prompt went unanswered four times). Read-only verification of the live catalog: 17 tables, RLS enabled and forced on all 17, 51 public policies (none for DELETE/ALL), 17 sync guard triggers, anon has 0 table privileges, authenticated has no DELETE/TRUNCATE, `delete_my_account()` is security definer (anon cannot execute, authenticated can), private `progress-photos` bucket (5 MB, jpeg/png/webp) with 4 owner-folder policies, 110 built-in exercises whose content digest equals the app's seed (`d189ab56…`).**
* Still to do: a live access test with two identities (rolled-back transaction; the tool wants an owner confirmation for it — not yet run), then in the dashboard set **Authentication → URL configuration → Site URL** to the redirect URL you use for password-reset links and decide whether *Confirm email* stays on (sign-up works either way; with confirmation on, the user confirms by e-mail before the first sign-in). Until you create an account in the app, nothing syncs — the app is fully usable offline.
* Never put the `service_role` key in the app, the repository or CI logs; the app does not need it.

## Verification log (actual results)

Everything below was observed in a real run; anything not listed was **not** verified. GitHub Actions runs are in the `Android verify (emulator)` workflow.

| Check | Result | Evidence |
| --- | --- | --- |
| Signature | **Verified**, APK Signature Scheme v2, one signer | apksig (local, at signing) and `apksigner verify` in CI run 4 |
| Signer = published fingerprint | **Match** — `2fff1f48…ea90e15` | `inspect-apk.sh` compares against `signing-cert.sha256`; fails the job on mismatch |
| File integrity | 5,467,992 bytes, SHA-256 matches `SHA256SUMS` and the downloaded copy | local `sha256sum` after downloading the public URL |
| Metadata (`aapt2 dump badging`) | package `com.monstergains.app`, **versionCode 14**, versionName **1.0.0**, compileSdk 36, **targetSdk 36**; permissions INTERNET, ACCESS_NETWORK_STATE, VIBRATE, POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED, WAKE_LOCK (annotation truncated after these) | CI run 4 annotation "APK badging". minSdk 24 comes from the build configuration (`aapt2` prints it as `minSdkVersion`, which the annotation filter did not include) |
| Zip alignment | `zipalign -c -v 4` OK | CI run 4 |
| Emulator | Android 14 (API 34), `sdk_gphone64_x86_64`, Pixel 6 profile, Google APIs, x86_64 | CI run 3 and 4 |
| Install of the **signed release APK** | OK (fresh install) | CI runs 1, 3 |
| Launch, foreground, process alive, no crash, relaunch after force-stop | **Passed** | CI runs 1, 3 and 5 |
| In-WebView journey on the debuggable twin of the same bundle: first launch shows onboarding → quick workout → exercise added → set logged (`1/3 sets`) → **app process killed** → relaunched → the set is still there (`reps=10`) | **Passed** | CI runs 3 and 5 (`…/actions/runs/40193117131`, `…/actions/runs/40193958874`) |

Honest notes:

* CI run 4 (a re-run after adding annotations) **failed** in the release smoke step: the first-generation heuristic — look for words such as "monster/next/today" in a `uiautomator` dump taken 10 s after launch — found none, although the same APK passed it in runs 1 and 3 and no crash was logged. That check was timing-sensitive (a WebView's text is not always exposed to `uiautomator` yet). It was replaced in `scripts/android/emulator-verify.sh` by a sturdier one: wait until the app window has focus, the process is alive, no `FATAL EXCEPTION`/ANR in logcat — also after a force-stop. **Run 5 on that script passed in full** (`https://github.com/Nayneessh/All-Claude-work/actions/runs/40193958874`): static checks, release install/launch/relaunch, and the WebView kill-and-relaunch journey. Result history: run 1 partial (journey client unsupported), run 2 failed (my journey assumed a Monday), run 3 passed, run 4 failed (flaky heuristic), run 5 passed.
* Release (non-debuggable) builds have WebView debugging disabled by design, so the DevTools journey uses the debug twin; the logic bundle is identical.
* Not verified: a physical phone, TalkBack, push notifications (including Snooze), battery/thermal behaviour, installing over an older build (there is none yet), Google Play Protect prompts on a real device.
