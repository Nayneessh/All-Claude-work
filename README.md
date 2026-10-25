# Monster Gains — signed Android release

* `MonsterGains-1.0.0.apk` — the app (Android 7.0+). Install over a previous version to keep your data.
* `SHA256SUMS` — `sha256sum -c SHA256SUMS`
* `signing-cert.sha256` — SHA-256 of the signing certificate. Compare with `apksigner verify --print-certs`.
* `test/` — debuggable twin of the same web bundle, used only by the emulator verification workflow. Do not install it on your phone.

Built from the commit recorded in `SOURCE_SHA` by GitHub Actions; signed with the project's release key (kept outside the repository).
