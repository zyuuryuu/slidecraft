/**
 * app-version.ts — the running app's version, as a plain importable constant (so release-check.ts
 * can compare it without a Tauri/DOM API call). Synced by scripts/bump-version.mjs alongside
 * package.json / tauri.conf.json / Cargo.toml (RELEASING.md's single-source rule); drift is caught
 * by tests/version-sync.test.ts.
 */
export const APP_VERSION = "0.3.0";
