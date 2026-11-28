# Friends edition

The same app and the same Supabase project, built so that someone else can use it **without anything of the owner's**: it starts empty, and the owner's routine is not in the file at all.

## What differs from the owner's build

| | Owner build (`com.monstergains.app`) | Friends build (`com.monstergains.app.friends`) |
| --- | --- | --- |
| First launch, step 3 | Offers the v6 routine (Arms First · Chest = Back, 98 sets/week, starting loads) and loads it | "Start with a clean slate" — nothing is offered or loaded |
| Today screen | Monday's planned workout | "No program yet" → *Start a quick workout* / *Set up a program* |
| The routine's data inside the APK | Yes (`src/data/seed/routineV6.ts`) | **No** — removed at build time and scanned for (below) |
| Application id | `com.monstergains.app` | `com.monstergains.app.friends` — installs as a separate app; cannot replace, read or touch the owner's app or its data |
| Signing key | the original release key (see *Key custody*) | its own key, fingerprint `95db3a58…88b2` |
| Everything else | — | identical: the full built-in exercise library, your own exercises, programs (create / edit with scope preview / versions / templates), quick workouts, add-activity, history and corrections, analytics, backup & export, reminders, optional cloud sync |

## How the routine is kept out of the file

1. `VITE_EDITION=friends` (set by `npm run build:friends` and by the `android-friends` workflow). `Onboarding.tsx` imports the routine only behind the literal check `import.meta.env.VITE_EDITION !== 'friends'`; the bundler replaces it with a constant and drops the branch, so there is no routine chunk. (A first attempt that tested a module-level constant left an unreferenced routine chunk in the output; the guard below caught it, and the check was inlined at each use.)
2. `scripts/check-friends-bundle.mjs` fails the build if the web bundle — or the web assets inside either APK — contains anything from the routine. Its 47 markers are derived from the seed file itself (every distinctive string literal in it that no other source file also uses), so it cannot go out of date; it also fails if a file name contains `routineV6`. It is unit-tested against a bundle that contains the routine, a single routine string, and minifier-escaped text (`src/test/friendsGuard.test.ts`).
3. It runs on every push (`ci.yml`: `npm run build:friends`), inside the APK workflow on both the release and the debug APK, and was run again by hand on the downloaded APKs.

## Accounts and data separation (same Supabase project)

* Each person's data lives first in their own phone's private app storage. Nothing from the owner's phone is in the APK.
* To back up / sync, a friend taps *Back up* on Today (or *Sign in* in onboarding) → **Create account** with e-mail + password. Their Gmail address works as the e-mail. They get their own `user_id`; their rows are theirs.
* Isolation is enforced by the database, not by the app. Checked on the live project on 2026-11-28 (read-only): all 17 tables have row-level security **enabled and forced**, each with 3 policies that all reference `auth.uid()`; the `anon` role has no table privileges; signed-in users can only select / insert / update (no delete). The two-identity behaviour (A cannot see, write or hijack B's rows; stale replays cannot overwrite) is covered by the PGlite suite against the real migration files (`supabase/tests`). **Not done:** a live two-account test against the hosted project.
* The built-in exercise library is shared and read-only for everyone; exercises a friend adds are private to them.
* "Sign in with Google" is **not** built. It needs a Google Cloud OAuth client, the Google provider switched on in Supabase Auth, and an in-app button plus Android deep-link handling — a separate piece of work.

### Supabase settings that affect new users (dashboard, owner only)

* **Confirm email** is on (the only existing account was confirmed 18 s after sign-up, i.e. by e-mail link). A friend must click the link before the first sign-in. The built-in mail sender has a very low hourly limit; if the e-mail does not arrive, wait and retry, or set up custom SMTP, or switch *Confirm email* off while onboarding friends.
* **Authentication → URL configuration → Site URL** decides where the confirmation / reset links land.
* Sign-ups are open to anyone who has the APK (as they are for the owner's build). Free-tier limits apply to the project as a whole.

## Building a new friends APK

1. Run the **Android build (friends edition)** workflow (`android-friends.yml`, manual). It builds the friends web bundle, runs the guard, assembles release + debug with `-PmgAppIdSuffix=.friends`, checks the application id and scans both APKs, then publishes the *unsigned* APKs to the `ci-artifacts-friends` branch.
2. Sign: `scripts/android/release.sh <app-release-unsigned.apk> <app-debug.apk> <out> Friends-<version>` (needs `.release/signing.env` and the key — see below).
3. Publish `<out>` to the `release-friends` branch (new commits only) and run **Android verify (emulator)** with `apk_branch=release-friends`, `package=com.monstergains.app.friends`, `edition=friends`.

## Current build

* `MonsterGains-Friends-1.0.1.apk` — 5,465,073 bytes, SHA-256 `e394c661e86daa751cfeb3d0ef477eb215a897f2f57cb22061fd74412683616d`
* signer SHA-256 `95db3a583cf37304eb114ddc68a88773a26ccf3c6137f5cd5394b6b84ca988b2` (CN=Monster Gains Friends Edition, RSA-4096, valid to 2056)
* built from commit `275d32e` (workflow run 1); web journeys for this edition: 4 passing (`e2e-friends/`); emulator results: see *Verification* in `docs/ANDROID_RELEASE.md`.

## Key custody — read this

* **The friends key** exists only in `.release/` of the workspace that built it (git-ignored, mode 600, never printed or committed). If it is lost, a friend cannot update in place later (they would back up, reinstall and sign in again). Hand-over on request; storing it in a password manager and adding the four `ANDROID_*` repository secrets lets CI sign without this workspace.
* **The owner's original release key was lost.** `.release/` (git-ignored) did not survive the workspace rebuild of 2026-11-24 and no copy exists. Effects: the installed 1.0.0/1.0.1 keeps working and keeps its data, but **no new build of the owner app can be installed over it** — Android compares signing certificates. A future owner update would mean: *Save a full backup* → make sure cloud sync is on → uninstall → install the new build → sign in / restore. That path has been tested at engine level (a "new phone restores the whole history identically" test) but not on a device with real data, so it should only be done deliberately, with the backup file saved outside the phone first. No new owner build has been published since the key was lost.

## Privacy notes

* The repository is **public**, so `src/data/seed/routineV6.ts` (the owner's routine, with starting loads) is readable on GitHub, and so are the published `release` / `release-friends` APKs. The friends APK does not contain the routine; the repository does. Making the repository private removes that exposure but also breaks the public APK download links and the unauthenticated daily health check.
