# Monster Gains — signed Android release

* `MonsterGains-1.0.1.apk` — the current app (Android 7.0+). **Install it over your existing app — do not uninstall first — and your data stays.**
* `previous/MonsterGains-1.0.0.apk` — the earlier release (kept for reference; Android will not downgrade over 1.0.1).
* `SHA256SUMS` — `sha256sum -c SHA256SUMS`
* `signing-cert.sha256` — SHA-256 of the signing certificate (same key for every release). Compare with `apksigner verify --print-certs`.
* `test/` — debuggable twins of the bundles, used only by the emulator verification workflow. Do not install them on your phone.

Built from the commit recorded in `SOURCE_SHA` by GitHub Actions; signed with the project's release key (kept outside the repository).

1.0.1 fixes: the on-screen keyboard flickering while typing, and the "swap exercise" screen freezing.
