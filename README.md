# Bi-Talks updates

## 4.0.24 — 2026-10-18

Complete cumulative application patch. Supported source versions: 4.0.19, 4.0.20, 4.0.21, 4.0.22 and 4.0.23 with the current update public key.

Signal contact notes now have a compact Notes / Collapse button. Notes are hidden by default. The expanded or hidden preference is remembered for the account's Signal profile. Existing note contents, encrypted storage, draft saving and contact isolation are preserved. The expanded editor adapts to header width. Only the Signal notes UI function and package version differ from 4.0.23; all other application files and auxiliary components are unchanged.

This is a complete cumulative patch containing the preceding application fixes. 25 files, 4,874,776 bytes. Ed25519 signature and per-file SHA-256 verification. Tested in an isolated browser: 16 interaction, persistence, header sizing and event isolation checks. Full patch installation, tamper rejection and rollback were tested in isolated directories. All 25 remote files were downloaded and verified before activation.

Use Settings → Check for updates, save drafts and confirm installation. Publishing this release does not hot-update or restart an existing local application. Accounts, messages, private notes and credentials are never uploaded. The patch does not replace Electron or the third-party Signal runtime.
