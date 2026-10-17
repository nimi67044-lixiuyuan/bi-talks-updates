# Bi-Talks updates

## 4.0.23 — 2026-10-17

Complete cumulative application patch for Windows. Supported source versions: 4.0.19, 4.0.20, 4.0.21 and 4.0.22, with the current update verification public key configured.

Includes the current application, account sidebar layout, DeepL translation and notification changes, Signal window synchronization, account startup improvements, and their auxiliary host components. Auxiliary components are included within signed `out/runtime-vendor/` files and used directly by the updated application.

25 files, 4,873,216 bytes. File URLs are pinned to an immutable commit. The manifest is signed with Ed25519; every file has a SHA-256 hash and declared size. Local verification covered full installation in an isolated directory, tamper rejection and rollback. All published files were downloaded again and their hashes verified before activating this manifest.

Use Settings → Check for updates, save drafts, then confirm installation and restart. Account data, chat history and personal settings are not included in this repository. This patch does not replace the Electron executable or upgrade the third-party Signal application runtime; use a complete installer when those components require updating.
