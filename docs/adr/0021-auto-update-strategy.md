# ADR-0021: 自動更新の初回戦略 — 軽量通知・完全署名 Updater は保留

- **Status**: Accepted（2026-07-07）
- **Date**: 2026-07-07

## Context

初回パブリックリリース（v0.1.0）に向けたリリース準備監査（ROADMAP「初回リリース マイルストーン」M12）で、
アプリの自動アップデート方針を決める必要が生じた。監査時点の実態：`tauri-plugin-updater` 不在・`plugins.updater`
設定なし・アップデート署名鍵ペアなし・`createUpdaterArtifacts` なし・`latest.json` 生成なし＝**全タッチポイントが空**。

完全な署名付き Tauri Updater を初回から導入する場合の重い/不可逆な論点：

- **アップデート署名鍵の不可逆性**：`tauri signer generate` の鍵ペアは一度配布すると**回転不可**（鍵を替えると
  既存クライアントが更新を検証できず孤立する）。初回リリースで背負うべきでない「重要 × 非自明」な判断。
- **4-OS の `latest.json` 集約**：release.yml は 4 プラットフォーム（mac arm64/Intel・Windows・Linux）を
  独立に署名・ビルドするため、単一の updater マニフェストへ集約する自作ステップが要る。
- **draft/publish フローとの矛盾**：release.yml は `releaseDraft: true`。GitHub の
  `releases/latest/download/latest.json` は publish 前は 404 で、updater が機能しない。フロー再設計が要る。

## Decision

ユーザ選択（2026-07-07）：**v0.1.0 は完全な署名付き Updater を導入しない。** 更新は次の手段で行う：

- **macOS** — `brew upgrade`（Homebrew cask が最新リリースを追跡。インストール時に quarantine を剥がすため最もクリーン）。
- **Windows / Linux** — GitHub Releases から最新インストーラを再ダウンロード。

加えて **軽量な「新版あり」アプリ内通知**（GitHub Releases API をポーリング → 現在版と比較 → dismissible バナー。
アプリ内ダウンロードや署名は伴わない）を UX として意図する。ただしその**実装は小さな follow-up**とし、v0.1.0 を
ブロックしない — 実装には (1) `api.github.com` を CSP `connect-src` allowlist に追加する egress 変更（[ADR-0016](0016-security-review-theme4.md)
のセキュリティ面に触れるため慎重に）、(2) ランタイムのアプリ版数取得の配線、(3) headless では検証できない実ポーリング、が伴うため。

リリース手順は [RELEASING.md](../../RELEASING.md) に、更新手段（brew / 手動再DL）を明記済み。

## Consequences

**良い点**
- 初回リリース時点で**不可逆なアップデート署名鍵のコミットを回避**できる。方針が固まってから、鍵管理を含めて
  完全 Updater を別途判断できる。
- macOS は brew cask が既に更新経路として機能する（追加実装ゼロ）。

**代償・限界**
- Windows/Linux の更新は当面**手動再DL**。軽量通知バナーが入るまで、ユーザは自発的に Releases を確認する必要がある。
- **軽量通知バナーは未実装**（follow-up）。純粋な版数比較ロジック＋GitHub Releases 参照＋CSP egress 追加＋バナー UI で
  構成する想定。ROADMAP のリリース後バックログで追跡。
- **完全な署名付き Tauri Updater は保留**（ROADMAP バックログ）。導入時は署名鍵の生成・保管・回転不能性を扱う
  新 ADR を起こし、`latest.json` 集約と draft/publish フローの再設計を行う。

## References

- リリース手順・バージョニング: [RELEASING.md](../../RELEASING.md)（版数単一ソース＝`tauri.conf.json`・M0）
- 計画: [docs/ROADMAP.md](../ROADMAP.md)（初回リリース マイルストーン M12・リリース後バックログ「完全な署名付き自動アップデート」）
- 関連: [ADR-0016](0016-security-review-theme4.md)（egress／CSP のセキュリティ面）・[ADR-0001](0001-product-form-desktop.md)（Tauri デスクトップ）
