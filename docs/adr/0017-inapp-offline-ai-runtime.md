# ADR-0017: 内蔵オフライン AI ランタイム＋環境適応モデルティア

- **Status**: Accepted
- **Date**: 2026-07（P1 spike 2026-07-01／P3 ランタイム PR #46／P2 プロバイダ PR #47／P5 weight DL PR #56／P4 staging PR #57／P6 mac 署名 branch `claude/p6-macos-signing`／モデルティア PR #68）

## Context

[ADR-0006](0006-ai-integration-architecture.md) で AI 統合を Core+Adapters に定め「ローカルモデル限定モード」を用意したが、そこで前提にしたローカルモデルは **外部の Ollama**（`localhost:11434`）＝ユーザが別途インストール・起動する必要があった。harness-over-model（[ADR-0005](0005-harness-over-model.md)）＋オフライン主義（`product_philosophy_harness`：フロンティア API に依存せず durable value をハーネス側に）を「**インストールしたら箱から出してすぐ動く**」まで届けるには、モデル実行系そのものをアプリが同梱・管理する必要がある。

制約：
- デスクトップ配布物に載せられる（Tauri `externalBin`・codesign/notarization を通る）。
- CPU-first（GPU 前提にしない）。
- OpenAI 互換サーバ（既存 `generateWithOpenAICompat` ＋ condense guardrail をゼロ glue で再利用）。
- weight は巨大（数 GB）ゆえ **同梱せず取得**（Windows の 4GB PE 制限も回避）。

モデル品質のジレンマ（Ollama で実測）：**3.8B（phi-3.5）は slide-edit 契約に不安定**（フォーマットラベル漏れ・曖昧入力で幻覚・誤訳）、**8B（granite/llama）はクリーン**（曖昧入力に no-op・翻訳方向正しい・日本語保持）。だが 8B は RAM/CPU を食う。全機に 8B 強制も、全機に 3.8B 固定も惜しい。

## Decision

- **ランタイム = 同梱 llamafile**（CPU-first・GGUF ネイティブ・内蔵 OpenAI サーバ → 「sidecar＝ただのもう1プロバイダ」に一致）。vLLM/HF-Transformers は却下（server/GPU/Python で bundle 不能）、ONNX は library-not-server で保留。BYO（custom provider → vLLM/ONNX/Ollama）は開いたまま。
- **`local_ai.rs` = `collab.rs` の兄弟ライフサイクル**：free-port pre-pick（`TcpListener :0`）＋ spawn `llamafile --server --host 127.0.0.1 --port <n> -m <gguf> --gpu disable` ＋ `/health` poll（毎 tick `try_wait` で **crash-fast**＝壊れた GGUF/OOM/ポート占有を即検知）＋ reap を `RunEvent::Exit`/`ExitRequested` 両方で。start は **`spawn_blocking`**（同期コマンドは cold-load 中に Tauri core thread をブロック→UI フリーズ、PR #55 で async 化）。lazy-on-first-use（`runTask` が builtin を初回自動起動）＋ ⏹ stop（メモリ解放）。
- **builtin provider**（`src/ipc/ai.ts`）：PROVIDERS に 1 行（`native:false, local:true, keyRequired:false`・`baseURL` は spawn 後に runtime-fill・`model`=pinned GGUF）。`isLocalTarget`/egress-gate/guardrail は 127.0.0.1 URL でそのまま通る。**デスクトップ既定プロバイダ＝builtin**（browser=Claude）。
- **weight は同梱しない・pinned URL+SHA256 で取得**：`ensure_model_weights`（stream→`.part`→SHA256 検証→**一致時のみ atomic rename**・HTTP Range resume・single-flight・オフライン `.gguf` import）。F3/F4 供給網規律（[ADR-0016](0016-security-review-theme4.md)）。
- **既定モデルは環境適応ティア**（`model_tier.rs`）：host の RAM/cores を probe し `recommend_tier`（**RAM ≥ 12288MB && cores ≥ 4 → Balanced（granite-4.1-8b・~5GB）**、それ以外 → **Small（phi-3.5-mini・~2.4GB）**）。「**少し計算量**」＝余裕がある時だけ 8B に上げる保守方針で、箱を使い切らない。14B quality tier は保留（CPU latency は別途検証）。ユーザ override（auto/small/balanced）は後続増分。granite 4.1 は **DENSE**（4.0 の hybrid MoE ではない）ゆえ同梱 llamafile 0.10.3 で走る。
- **配布 = ENV-FREE**：`stage-llamafile.mjs` が THIN launcher（44MB）を pinned+SHA256 取得 → native runner で `--assimilate`（APE→native ELF/Mach-O・WSL binfmt 回避・codesign 可能に。Windows は raw APE を `.exe` として PE 実行）。`externalBin += binaries/llamafile`。P4（bundle）＋P5（auto-DL）で「install→有効化→自動DL→動く」。

## Consequences

- Windows/Linux は **env-free 配布可能**（install → 有効化 → モデル自動DL → 動く）。dev は `SLIDECRAFT_LLAMAFILE`/`SLIDECRAFT_GGUF` の escape hatch。
- 実機検証済み（Windows 2026-07-01）：spawn → `/health` → baseURL fill → スライド編集を end-to-end 生成（~10 tok/s CPU・736 tokens）。granite Balanced tier も実機で DL 確認（PR #68）。
- **macOS は release-time gate**：ad-hoc sign（`signingIdentity="-"`・`hardenedRuntime=false`＝llamafile の GGML JIT/exec-mem を殺さないため）＋ own Homebrew tap（cask が `com.apple.quarantine` を剥がす→notarization 不要）。branch `claude/p6-macos-signing` 実装済だが **mac runner 未検証**（Actions 無効中＝`ci_actions_billing`）。Developer-ID + notarization（$99）は defer。
- **do-NOT-undo**：
  - 127.0.0.1 ハードコード・`0.0.0.0` にしない・port を world-readable file に書かない（token 無し＝Ollama parity・egress gate が真の制御）。
  - weight DL の SHA256 検証を外さない（検証**前**に実行/rename しない・不一致は `.part` 削除）。
  - spawn flags は `--gpu disable`（0.10.3 は `-ngl 0`/`--nobrowser` でクラッシュ）。
  - mac で `hardenedRuntime` を true にしない（notarize しない限り JIT を殺す）。
  - `start_local_ai` を同期に戻さない（core thread フリーズ）。
  - llamafile を universal-APE のまま `externalBin` にしない（Tauri の per-bin codesign で notarization hard-fail）。
- トレードオフ：8B の CPU latency は許容（余裕機のみ）／14B quality tier 保留／mac 実機検証は CI 再開待ち／override UI は後続。

## References

- コード：`src-tauri/src/local_ai.rs`・`src-tauri/src/model_tier.rs`（`recommend_tier`/`spec_for`/`builtin_model_info`）・`src-tauri/src/lib.rs`（wiring）・`scripts/stage-llamafile.mjs`・`src/ipc/ai.ts`（builtin provider）・`src/components/useAiGeneration.ts`（connection ladder・auto-start）・`src-tauri/tauri.bundle.conf.json`／`.github/workflows/release.yml`（mac ad-hoc sign）・`packaging/homebrew/`
- 関連 ADR：[ADR-0006](0006-ai-integration-architecture.md)（AI 統合＝本 ADR が具体ランタイムで延長）・[ADR-0005](0005-harness-over-model.md)（harness-over-model）・[ADR-0016](0016-security-review-theme4.md)（spawn/DL のセキュリティ監査面）
- 開発メモリ：`llamafile_runtime_design`・`inapp_ai_design`・`ai_integration_state`・`ci_actions_billing`
