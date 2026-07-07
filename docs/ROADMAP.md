# SlideCraft ロードマップ

**前向きの計画のみ**を記す。実装済みの履歴は **[shipped.md](shipped.md)**、決定の記録は [docs/adr/](adr/)、詳細な経緯は git（PR）を参照。

**現在地（2026-07-07）**：named 主要テーマ 1〜4＋差別化アーキ（内蔵 AI・AI 編集の採用ゲート・協働ホスト）まで完了（[shipped.md](shipped.md)）。**いま：初回パブリックリリース（v0.1.0）に向けた工程化フェーズ** — 下記マイルストーン参照（**M0 バージョン・M1 ci.yml 軽量化・M2 npm audit・M4 LICENSE・M6 セキュリティ再チェック 完了 → 残るクリティカルパスは M3 Actions 再有効化＝要ユーザ操作**）。リリース後の将来テーマは「バックログ」へ。

> **既知の仕様（非バグ・再調査不要）**：表セル文字・図ノード文字は独立図形のため、スライドマスター body 書式には非追従（継承対象外）。

---

## 🚀 初回リリース（v0.1.0）マイルストーン

リリース準備監査（2026-07-07・7観点）に基づく工程。**バージョン統一 → CI 軽量化＆再有効化 → release.yml 実走 → 実機検証 → 品質1周 → 出荷**をクリティカルパスに、法務/ブランド/セキュリティ/マニュアルは並行。方針決定（ユーザ 2026-07-07）：**バージョン＝v0.1.0（pre-1.0＝早期・API 不安定を明示）／自動更新＝初回は軽量通知のみ・完全署名 Updater は出荷後（不可逆な鍵コミット回避）**。

状態: **✅ READY**（着手可）／**🔗 DEPENDS**（先行あり）／**💬 DISCUSS**（設計/デザイン未確定）。Size: S<1日・M 2-3日・L 1週。

| # | 項目 | 内容の核 | 依存 | Size | 状態 |
| --- | --- | --- | --- | --- | --- |
| M0 | バージョン単一ソース化 | `package.json 0.0.0→0.1.0`（現行ドリフト是正）。単一ソース＝`tauri.conf.json`、bump スクリプトで3 config＋ハードコード2箇所（`mcp/server.ts`・`ipc/collab-client.ts`）＋cask へ伝播。`CHANGELOG.md`（Keep-a-Changelog）＋`RELEASING.md`＋semver 方針（crate 名リネームは cosmetic follow-up として分離） | — | M | 🏁 完了（PR #78） |
| M1 | ci.yml 軽量化 | push/PR 毎の 3-OS Tauri build を **release/tag 限定へ移設**（cross-OS packaging は `release.yml` に既存）。push CI は Linux のみ＋test/e2e/lint 維持・`paths-ignore`(docs)・`timeout-minutes`・`permissions: contents:read`（rust-cache は follow-up） | — | M | 🏁 完了（PR #81） |
| M2 | npm audit triage（ADR-0016 F4） | high 7件を triage。実行時到達は `mermaid→chevrotain/langium→lodash-es` のみ・vite/esbuild は dev-only（`--omit=dev` 除外）。解決 or 明示受容後に security ゲートを required 化。**npm audit fix で high 7＋mod 4 解消・残 dev-only 1 low 受容・gate required 化済** | — | S | 🏁 完了（PR #81） |
| M3 | GitHub Actions 再有効化 | 軽量化後に `actions/permissions enabled=true`、小 push で per-push コストが Linux 限定になったことを確認（現在も無効・[[ci_actions_billing]]） | M1, M2 | S | 🔗 DEPENDS |
| M4 | LICENSE＋第三者/モデル重み attribution | root に LICENSE 新設・README「Private」是正・`package.json` license。`THIRD-PARTY-NOTICES`（npm/crate/**llamafile〔Apache-2.0＋llama.cpp MIT の NOTICE 伝播〕/Node/DL モデル重み〔Phi-3.5=MIT・Granite 4.1=Apache-2.0〕**）・CREDITS 拡張・`bundle.license/copyright` | — | M | 🏁 完了（PR #79） |
| M5 | 本アプリアイコン | 仮の青地「S」→ 正式デザイン確定 → `tauri icon` で全形式/サイズ再生成 | — | S | 💬 DISCUSS |
| M6 | セキュリティ再チェック（新3面） | ADR-0016 以降の新サーフェスを是正：**画像 `src` を `data:image` に zod 制約**（現状 `z.string()`＝`javascript:`/remote 永続化 XSS 経路）・export HTML の nonce-CSP を全経路で常時付与アサート・画像 data-URI サイズ上限（DoS）・`register_templates` store 上限・新面（画像/MCP/カスタムレイアウト OOXML）を敵対再監査 → **ADR-0016 addendum** | M0 | M | 🏁 完了（PR #80） |
| M7 | ユーザマニュアル | コアループ Draft→Edit→export／Markdown 基本（区切り・`<!-- col/kpi/step -->`・表・画像・図フェンス）／**authorable 12種＋mermaid 限定4種**（先に「図12 vs 14」記述矛盾を正典 `VALID_TYPES` で統一）／二段階編集／テンプレ取込・修復・作成／内蔵 AI 有効化＋初回モデル自動DL／HTML・PPTX export。アプリ内 Help/? 導線＋サンプル明示 | 図本数統一 | L | ✅ READY |
| M8 | release.yml 実走（dry-run） | v-tag を1本 push し、4-OS installer＋draft release が実際に通ることを実証（tag 実績 0＝未検証） | M3, M0 | M | 🔗 DEPENDS |
| M9 | 実機検証（Win/mac） | インストーラ起動・**mac ad-hoc 署名 .dmg が `killed:9` せず開く**・F3 keychain round-trip（WSL 未検証）・モデル自動DL UX・レジストリ永続化 E2E | M8 | M | 🔗 DEPENDS |
| M10 | PowerPoint 実機開封チェック | 生成 PPTX を実 PowerPoint / PowerPoint for the web で開き見た目確認（現状 python-pptx＋wellformed-gate のみ） | — | S | ✅ READY |
| M11 | レンダ品質1周 | 実 render（Playwright `page.pdf`）で高インパクト UX バグを掃討：不可視の締めスライド・低コントラスト図ラベル等（`図/テンプレ品質の磨き込み` の先行分） | — | S | ✅ READY |
| M12 | 自動更新（軽量版・ADR 化） | 完全署名 Updater は見送り、GitHub Releases API ポーリングで「新版あり」通知のみ（鍵不要）＋mac は brew・Win/Linux 手動再DL。**この選択を ADR 化** | M8 | S | 💬 DISCUSS |
| M13 | 出荷（v0.1.0） | `RELEASING.md` 手順：bump→CHANGELOG→tag→draft レビュー→cask 更新→publish | 全 Must 完了 | S | 🔗 DEPENDS |

**クリティカルパス**：M0・M1・M2（並行）→ M3 → M8 → M9 → M11 → M13。M4/M5/M6/M7/M10/M12 は M3 と並行進行可。
**Must（初回ブロッカー）**：M0–M4, M6–M11, M13。**含める任意**：M5（アイコン）・M12（軽量自動更新）。
**Defer（出荷後）**：完全署名 Tauri Updater・i18n（日英）・F1'（egress hard boundary）・`.slidecraft` 形式バージョニング・partial-gen P2〜P4・`SlidePreview.tsx` 分割（631行）。

---

## バックログ（リリース後・将来）

### 🧠 AI 編集の深化

| 項目 | 内容 | サイズ |
| --- | --- | --- |
| 部分生成の続き（P2〜P4） | ops 化は **P1＝図コンテンツで実装済**（→shipped）。**テキスト編集はまだ全文再生成＝drift の温床**が残る。残り：**P2 placeholder テキスト ops**（`applyFieldEdit` 即利用）／**P3 chart・table・gantt ops**（series/cards/tasks/cell）／**P4 refine・batch 経路への ops 配線＋delta 成功率テレメトリ**。触点: `diagram-edit-ops.ts`（雛形）・`placeholder-binding.applyFieldEdit`・`ai-apply.ts`（マージ）・`llm-prompts` | M〜L |
| 生成の encoding 事故を構造で抑止（#12-D） | 弱モデルの `\uXXXX` 違反を**発生させない**根本抑止。案：(D-1) 生成を per-slide 分割し違反の被害半径を1枚に＋壊れた1枚だけ再試行（`extractSlidePlan` 既存）／(D-2) 本文を JSON 文字列から出しエスケープ不要な形式へ。現状は floor（違反破棄＋告知）で担保済。着手時に設計 | M |

### 🖼 HTML / 描画品質

| 項目 | 内容 | サイズ |
| --- | --- | --- |
| 図/テンプレ品質の磨き込み | 実レンダ敵対監査（全30枚・Playwright→エージェント目視）で検出。**共有エンジン由来でプレビュー/PPTX にも出る既存問題**：図のエッジ/関係ラベルが**低コントラスト＋ノード衝突＋折返し**（最頻・効き目大／`diagram-painter` 系）・**閉じスライドが白地に薄色文字で不可視**（Closing レイアウトの背景抽出）・レーダー等の**図タイトルがヘッダと重複**（`omitTitle` 未効き疑い）。共有 painter/テンプレ抽出に触る＝PPTX にも波及（golden 検証必須）。※ 高インパクト分は初回リリース M11 で先行 | M |
| @font-face CJK 埋め込み（設計 S7） | Noto Sans/Serif JP サブセットを data URI 内蔵しクロスマシン完全再現（現状は順序付きフォールバックスタック）。前提＝`<a:ea>` フォント抽出＋明朝/ゴシック分類。サブセット化ツールが新規に必要 | M |

### 📄 テンプレ / マスター

| 項目 | 内容 | サイズ |
| --- | --- | --- |
| 内蔵 30 レイアウトのオミット | Midnight Executive 30 種は**開発用** — 主要テーマ（＋一部バックログ）完了後にビルトイン同梱をやめ、canonical .pptx は入力サンプルとしてリポジトリ内に残置。触点: `useMasterRegistry` の `BUILTIN_URL`＋起動 fetch（→ 残置サンプル参照 or `writeTemplate` で起動時生成）・`BUILTIN_LAYOUTS` の既定セット差し替え・`LAYOUT_NAMES` フォールバックの整理・テスト fixture パス・`scripts/rebuild-template.ts` 引退。ランタイムはロールベースで 30 種非依存（alien テストでゲート済み）のため作業はこの触点に閉じる | S〜M |
| テンプレ資産の棚卸 | `public/templates/slide/` に `.potx`（未追跡6）＋`_全レイアウト見本.pptx`（tracked）が堆積。**アプリが束ねる built-in は canonical `Midnight_Executive_30_TemplateOnly.pptx` 1本のみ**（ディレクトリ列挙なし）。棚卸：参照ゼロの見本7件＋未追跡 `.potx` を「テンプレ管理」機能で**束ねる(A)** か **整理/削除(B)** か決定。将来案：データを **`.potx` 形式に一本化**（見本は生成 or 廃止）。⚠ **テスト fixture（`lrk-slides-velis_CC0`／`報告書テンプレート_全レイアウト見本`／`配布資料_公文書高密度_全レイアウト見本`／`報告書テンプレート_官公庁_全レイアウト見本`）は削除不可** | S |

### 🖥 UX / オンボーディング / 配布

| 項目 | 内容 | サイズ |
| --- | --- | --- |
| UI 日英表記切り替え（i18n） | UI 文言の 日本語⇄英語 トグル。現状は日本語ハードコード → 文字列を抽出し言語切替を提供（ユーザ要望・初回リリースは日本語ファースト） | M〜L |
| 完全な署名付き自動アップデート | 初回は軽量通知（M12）で代替。出荷後：`tauri signer` 署名鍵ペア＋`plugins.updater`＋4-OS の `latest.json` 集約＋draft/publish フロー再設計。鍵は回転不可の不可逆判断（ADR 化） | M |

### 🔒 セキュリティ

| 項目 | 内容 | サイズ |
| --- | --- | --- |
| F1'（egress hard boundary）｜LOW（保留） | 保留（F2 で前提縮小）：`http:default` の `https://**` を CSP 一致 allowlist（3 AI API＋`huggingface.co`＋`cdn-lfs*.huggingface.co`〔モデルDL の LFS CDN 302 先・含めないと DL 破綻〕＋loopback）に縮小し、承認済み custom host を **Rust 側 egress ゲート**（reqwest・host allowlist 強制）で通す実境界化。streaming fetch の Rust 越し再実装を要し大きめ。触点: `src-tauri/capabilities/default.json`・Rust command・`src/ipc/app-fetch.ts` | M |

---

## 保留中の依存・運用

- **js-yaml v5 更新** — dependabot **PR #13（OPEN）**：`js-yaml` 4.3.0 → 5.2.0。破壊的変更の確認待ち。
- **`.slidecraft` 形式バージョニング（前方互換保険）** — deck/project バンドルに schema version を埋め込む。後付けは困難だが初回リリースのスコープ外（着手時に検討）。
- **実験用一時ファイルの後始末** — テンプレ検証・headless 生成で散らかった temp 出力（`_probe.ts`・未追跡 `.potx` 等）を整理（↑「テンプレ資産の棚卸」と関連・出荷前 M13 で掃除）。
- **column 内 table の認識（小改修）** — separator レイアウト（col/card/kpi/step）の各カラムは図（```diagram/mermaid```）は拾うが **GFM テーブルは本文テキスト化**（`extractFencedBlock` のみ・`findTableInLines` 未適用）。列内テーブルを native table として拾う（[ADR-0020](adr/0020-image-embedding.md) 敵対レビューで確認・画像とは独立）。触点: `md-slide-parser.ts` separator 分岐。
- **最背面画像のプレビュー直接ドラッグ（小）** — 最背面レイヤーはハンドルが content の下に隠れるため現状フォーム編集のみ。編集 chrome（枠線＋角ハンドル）だけを前面 overlay 化してドラッグ/リサイズを再有効化（[ADR-0020](adr/0020-image-embedding.md)）。
