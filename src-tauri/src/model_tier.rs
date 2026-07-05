//! model_tier.rs — pick the DEFAULT in-app model by host capability, instead of hard-pinning one.
//!
//! Rationale (measured via Ollama across sizes): the 3.8B phi-3.5 is unreliable on the slide-edit
//! contract (leaks format labels, hallucinates on vague input, mistranslates), while an 8B
//! (granite/llama) follows it cleanly — a no-op on a vague instruction, correct translation
//! direction, and Japanese preserved. So a machine that can comfortably run 8B should DEFAULT to it.
//! Conservative on purpose ("少し計算量"): step up only with headroom, never max out the box; the
//! 14B "quality" tier is deferred (CPU latency needs its own validation). The user can override.
//!
//! This module is the PURE policy + a capability probe. The tier→GGUF catalog and the download
//! wiring live in local_ai.rs (kept here as the single source of the selection rule, unit-tested).

use serde::Serialize;

#[derive(Clone, Copy, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    /// phi-3.5-mini 3.8B (~2.4 GB) — the safe floor; leans on the harness floor + intent chips.
    Small,
    /// an 8B (granite/llama, ~5 GB) — clean on the edit contract; the "少し計算量" sweet spot.
    Balanced,
}

/// Recommend a tier from total RAM (MB) and logical cores. Balanced (8B, ~5 GB weights + KV + the
/// app/OS) needs comfortable headroom AND enough cores for tolerable CPU inference; otherwise Small.
pub fn recommend_tier(total_ram_mb: u64, cores: usize) -> Tier {
    if total_ram_mb >= 12_288 && cores >= 4 {
        Tier::Balanced
    } else {
        Tier::Small
    }
}

/// The GGUF a tier downloads + runs. Pinned URL + SHA256 (F3/F4 supply-chain discipline: an
/// integrity-verified download, refused on mismatch). Update the sha256 if the upstream re-quants.
pub struct ModelSpec {
    /// Filename under app-local-data/models/.
    pub file: &'static str,
    /// HF `resolve/main` URL (reqwest follows the LFS-CDN redirect; not the webview http scope).
    pub url: &'static str,
    /// SHA256 of the GGUF content (HF git-LFS oid).
    pub sha256: &'static str,
}

/// The model each tier ships. Small = phi-3.5-mini 3.8B (safe floor); Balanced = granite-4.1-8B
/// DENSE (measured cleaner on the slide-edit contract; dense arch runs on the bundled llamafile).
pub fn spec_for(tier: Tier) -> ModelSpec {
    match tier {
        Tier::Small => ModelSpec {
            file: "phi-3.5-mini-instruct-q4_k_m.gguf",
            url: "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf",
            sha256: "e4165e3a71af97f1b4820da61079826d8752a2088e313af0c7d346796c38eff5",
        },
        Tier::Balanced => ModelSpec {
            file: "granite-4.1-8b-Q4_K_M.gguf",
            url: "https://huggingface.co/unsloth/granite-4.1-8b-GGUF/resolve/main/granite-4.1-8b-Q4_K_M.gguf",
            sha256: "0f45c1af986e9900bb3b6ba46a25937e1bb80426935bc242d88c9ca90e9f5c88",
        },
    }
}

/// The tier the app uses now: the detected recommendation. A persisted USER OVERRIDE
/// (auto/small/balanced) is a later increment; the default is auto.
pub fn selected_tier() -> Tier {
    let (ram, cores) = detect_capability();
    recommend_tier(ram, cores)
}

/// (total RAM in MB, logical cores) for the host.
fn detect_capability() -> (u64, usize) {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_memory();
    let total_ram_mb = sys.total_memory() / 1024 / 1024; // sysinfo ≥0.30 reports bytes
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
    (total_ram_mb, cores)
}

/// The tier the app would pick by default on this machine (the UI can show/override it).
#[tauri::command]
pub fn recommended_model_tier() -> Tier {
    let (ram, cores) = detect_capability();
    recommend_tier(ram, cores)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn low_ram_or_few_cores_stays_small() {
        assert_eq!(recommend_tier(8_000, 8), Tier::Small); // 8 GB box → small
        assert_eq!(recommend_tier(16_000, 2), Tier::Small); // dual-core → small (CPU latency)
        assert_eq!(recommend_tier(4_000, 2), Tier::Small);
    }

    #[test]
    fn roomy_machine_steps_up_to_balanced_but_not_maxed() {
        assert_eq!(recommend_tier(16_000, 8), Tier::Balanced);
        assert_eq!(recommend_tier(65_000, 24), Tier::Balanced); // a 64 GB/24-core box → balanced, not maxed
    }

    #[test]
    fn boundary_is_inclusive() {
        assert_eq!(recommend_tier(12_288, 4), Tier::Balanced);
        assert_eq!(recommend_tier(12_287, 4), Tier::Small);
    }

    #[test]
    fn spec_matches_tier() {
        assert!(spec_for(Tier::Small).file.contains("phi-3.5"));
        assert!(spec_for(Tier::Balanced).file.contains("granite-4.1-8b"));
        for t in [Tier::Small, Tier::Balanced] {
            let s = spec_for(t);
            assert_eq!(s.sha256.len(), 64, "sha256 must be 64 hex chars");
            assert!(s.url.starts_with("https://huggingface.co/") && s.url.contains("/resolve/main/"));
        }
    }
}
