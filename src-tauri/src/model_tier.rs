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
}
