//! secret_store.rs — OS keychain storage for the BYOK API key (ADR-0016 F3).
//!
//! The key is kept OUT of the JS-reachable `localStorage`: only these commands touch it, backed by
//! the platform credential store (Windows Credential Manager / macOS Keychain / Linux Secret
//! Service). This removes the plaintext-at-rest bucket and the trivial `localStorage.getItem`
//! XSS-read. When no OS backend is available (browser build, or a Linux box with no Secret Service),
//! the commands return an error and the webview falls back to localStorage (status quo — no
//! regression, strict upgrade where a keychain exists). NOTE: this fixes at-rest exposure; full
//! decoupling of key-theft from a webview compromise needs the Rust egress proxy (ADR-0016 F1').
use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "com.slidecraft.desktop";

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| e.to_string())
}

/// Store (or overwrite) a secret under `account`. Errors if no OS keychain backend is available.
#[tauri::command]
pub fn secret_set(account: String, value: String) -> Result<(), String> {
    entry(&account)?.set_password(&value).map_err(|e| e.to_string())
}

/// Read a secret; `Ok(None)` when the account has no stored value (not an error). Errors only when
/// the backend itself is unavailable, so the webview can distinguish "empty" from "no keychain".
#[tauri::command]
pub fn secret_get(account: String) -> Result<Option<String>, String> {
    match entry(&account)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Delete a secret. A missing entry is a no-op success (idempotent).
#[tauri::command]
pub fn secret_delete(account: String) -> Result<(), String> {
    match entry(&account)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
