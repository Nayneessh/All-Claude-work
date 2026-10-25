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
* Migrations to apply, in order: `supabase/migrations/20261025000001_core_schema.sql`, then `…000002_seed_exercise_library.sql`. **Status: not applied yet.** The Supabase tool asked the owner a confirmation that has not been answered, and no alternative route was used. Until then the app runs fully offline-first; the account screen will sign in but nothing can sync.
* After applying: run `supabase/tests/rls.test.ts` logic against the live project (same assertions, in rolled-back transactions), then in the dashboard set **Authentication → URL configuration → Site URL** to the app/redirect URL you use for password-reset links, and decide whether *Confirm email* stays on. (Sign-up works either way; with confirmation on, the user confirms by e-mail before the first sign-in.)
* Never put the `service_role` key in the app, the repository or CI logs; the app does not need it.

## Verification log (actual results)

See the section appended below by the verification run; anything not listed there was **not** verified.
