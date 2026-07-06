# SlideCraft ロードマップ

前方向きの計画のみを記す。完了フェーズの履歴は **ADR ＋ git（PR）** に移管済み。決定の記録は `docs/adr/` を参照。

**現在地（2026-07-06）**：土台（テンプレ堅牢性）・差別化アーキ（内蔵 AI＝llamafile 同梱 P1〜P6・[ADR-0017](adr/0017-inapp-offline-ai-runtime.md)／AI 編集の検証は採用ゲート・[ADR-0018](adr/0018-validation-at-adoption-gate.md)）に加え、
named 主要テーマ **1〜4 は全て完了** — テーマ1「HTML 出力」[ADR-0013](adr/0013-svg-native-text.md)／
テーマ2「テンプレ作成補助」[ADR-0014](adr/0014-template-authoring.md)／テーマ3「MCP ブラッシュアップ」[ADR-0015](adr/0015-mcp-brushup.md)／
テーマ4「セキュリティレビュー」[ADR-0016](adr/0016-security-review-theme4.md)。各テーマの経緯・意思決定は対応 ADR ＋ git（PR）、
背景メモは開発メモリ `html_output_design` / `roadmap_post_p2`。

**以降の消化（〜2026-07-06）**：**AI 編集の部分生成＋自己修復＋best-of-N**（[ADR-0019](adr/0019-partial-edit-ops.md)：図コンテンツを ops 化＝drift ゼロ〔P1〕・全文逸れの単発リテイク〔Option A〕・N候補→採用ゲート選別〔best-of-N・単一/全体/一括すべて完了〕）／
**スライド構造編集**（追加・複製・削除・pointer ドラッグ並べ替え）／
**画像機能**（data URI 埋め込み・サイズ/位置の微調整＋サイズスライダー・pic 枠への優先バインド・最背面レイヤー＝[ADR-0020](adr/0020-image-embedding.md)）／
UI 配色モード（Dark/Light/Modern）・MCP エラー契約統一・`useAiGeneration` 分割。
テーマ4 是正は **F1〜F4 実装済**（F1/F3/F4＝PR #66、F2 svgCache XSS＝commit `20978cd`）、残は **F1'（egress hard boundary・保留）** のみ。

**次の大物テーマは未定** — 下記バックログから選定する。

---

> **既知の仕様（非バグ・再調査不要）**：表セル文字・図ノード文字は独立図形のため、スライドマスター body 書式には非追従（継承対象外）。

---

## バックログ（将来）

### 🧠 AI 編集の深化

> **実装済（表から除去・[ADR-0019](adr/0019-partial-edit-ops.md)）**：部分生成 P1（図コンテンツ ops 化・drift ゼロ）／自己修復リテイク（Option A・全文逸れ検出で ops 再試行）／best-of-N（Option B・単一/whole-deck refine/batch すべて）。

| 項目 | 内容 | サイズ |
| --- | --- | --- |
| 部分生成の続き（P2〜P4） | ops 化は **P1＝図コンテンツで実装済**（変更フィールドのみ出力→決定論マージ・drift ゼロ・[ADR-0019](adr/0019-partial-edit-ops.md)）。**テキスト編集はまだ全文再生成＝drift の温床**が残る。残り：**P2 placeholder テキスト ops**（`applyFieldEdit` 即利用）／**P3 chart・table・gantt ops**（series/cards/tasks/cell）／**P4 refine・batch 経路への ops 配線＋delta 成功率テレメトリ**。触点: `diagram-edit-ops.ts`（雛形）・`placeholder-binding.applyFieldEdit`・`ai-apply.ts`（マージ）・`llm-prompts` | M〜L |
| 生成の encoding 事故を構造で抑止（#12-D） | 弱モデルの `\uXXXX` 違反を**発生させない**根本抑止。案：(D-1) 生成を per-slide 分割し違反の被害半径を1枚に＋壊れた1枚だけ再試行（`extractSlidePlan` 既存）／(D-2) 本文を JSON 文字列から出しエスケープ不要な形式へ。現状は floor（違反破棄＋告知＝#12-5 C）で担保済。着手時に設計 | M |

### 🖼 HTML / 描画品質

| 項目 | 内容 | サイズ |
| --- | --- | --- |
| 図/テンプレ品質の磨き込み | 実レンダ敵対監査（全30枚・Playwright→エージェント目視）で検出。**共有エンジン由来でプレビュー/PPTX にも出る既存問題**：図のエッジ/関係ラベルが**低コントラスト＋ノード衝突＋折返し**（最頻・効き目大／`diagram-painter` 系）・**閉じスライドが白地に薄色文字で不可視**（Closing レイアウトの背景抽出）・レーダー等の**図タイトルがヘッダと重複**（`omitTitle` 未効き疑い）。共有 painter/テンプレ抽出に触る＝PPTX にも波及（golden 検証必須）。監査 harness は再利用可（`html_output_design`） | M |
| @font-face CJK 埋め込み（設計 S7） | Noto Sans/Serif JP サブセットを data URI 内蔵しクロスマシン完全再現（現状は順序付きフォールバックスタック）。前提＝`<a:ea>` フォント抽出＋明朝/ゴシック分類。サブセット化ツールが新規に必要 | M |

### 📄 テンプレ / マスター

| 項目 | 内容 | サイズ |
| --- | --- | --- |
| MCP: テンプレ選択（S2 増分2） | `list_templates`/`use_template(id)` で登録済みテンプレを AI が選べるように。GUI の master レジストリ（`useMasterRegistry`/`src/ipc/master-store.ts`＝Tauri fs 裏）を `HostContext` に accessor 注入する host 機能で GUI 側実装と対。stdio は `create_template`／bytes 持参で代替可。[ADR-0015](adr/0015-mcp-brushup.md) の残タスク | S〜M |
| テンプレ作成の後続 UI | 作成モーダルの埋め込みライブプレビュー・レイアウトサブセット選択・カスタムレイアウト定義 | M |
| 内蔵 30 レイアウトのオミット | Midnight Executive 30 種は**開発用** — 主要テーマ（＋一部バックログ）完了後にビルトイン同梱をやめ、canonical .pptx は入力サンプルとしてリポジトリ内に残置。触点: `useMasterRegistry` の `BUILTIN_URL`＋起動 fetch（→ 残置サンプル参照 or `writeTemplate` で起動時生成）・`BUILTIN_LAYOUTS` の既定セット差し替え・`LAYOUT_NAMES` フォールバックの整理・テスト fixture パス・`scripts/rebuild-template.ts` 引退。ランタイムはロールベースで 30 種非依存（alien テストでゲート済み）のため作業はこの触点に閉じる | S〜M |
| テンプレ資産の棚卸 | `public/templates/slide/` に `.potx`（未追跡6）＋`_全レイアウト見本.pptx`（tracked）が堆積。**アプリが束ねる built-in は canonical `Midnight_Executive_30_TemplateOnly.pptx` 1本のみ**（ディレクトリ列挙なし）。棚卸：参照ゼロの見本7件＋未追跡 `.potx` を「テンプレ管理」機能で**束ねる(A)** か **整理/削除(B)** か決定。将来案：データを **`.potx` 形式に一本化**（見本は生成 or 廃止）。⚠ **テスト fixture（`lrk-slides-velis_CC0`／`報告書テンプレート_全レイアウト見本`／`配布資料_公文書高密度_全レイアウト見本`／`報告書テンプレート_官公庁_全レイアウト見本`）は削除不可**。レジストリ永続化はテーマ2 S6 で実装済み — その後続として着手 | S |
| テンプレ生成の実機確認（残り＝PowerPoint 開封のみ） | **2026-07-04 実施済み**: 多レンズ構造検証（expat 整形式・python-pptx 完全開封・rels/Content-Types 整合、`tests/pptx-wellformed.test.ts` / `template-writer-conventions.test.ts` で恒久ゲート化）＋実アプリ取り込みをユーザ確認。副産物として canonical の整形式破損を発見・根絶（`31c556e`）。**残り**: PowerPoint 実機での開封/見た目確認 — 開発機に PowerPoint 無し。PowerPoint for the web（OneDrive にファイルを置いて office.com で開く）か PowerPoint のある別マシンで。Tauri 実機のレジストリ永続化 E2E も同時に | S |

### 🖥 UX / オンボーディング / 配布

| 項目 | 内容 | サイズ |
| --- | --- | --- |
| UI 日英表記切り替え（i18n） | UI 文言の 日本語⇄英語 トグル。現状は日本語ハードコード → 文字列を抽出し言語切替を提供（ユーザ要望） | M〜L |
| ユーザ利用ガイド | 図 14 種・二段階編集・テンプレ流し込みを網羅したオンボーディング | M |
| アプリアイコン正式デザイン | 仮アイコン（青背景 "S"）を正式版へ差し替え | S |
| 自動アップデート | Tauri Updater 経由（GitHub Releases） | M |

### 🔒 セキュリティ

| 項目 | 内容 | サイズ |
| --- | --- | --- |
| F1'（egress hard boundary）｜LOW（保留） | 保留（F2 で前提縮小）：`http:default` の `https://**` を CSP 一致 allowlist（3 AI API＋`huggingface.co`＋`cdn-lfs*.huggingface.co`〔モデルDL の LFS CDN 302 先・含めないと DL 破綻〕＋loopback）に縮小し、承認済み custom host を **Rust 側 egress ゲート**（reqwest・host allowlist 強制）で通す実境界化。streaming fetch の Rust 越し再実装を要し大きめ。触点: `src-tauri/capabilities/default.json`・Rust command・`src/ipc/app-fetch.ts` | M |

---

## 保留中の依存・運用

- **js-yaml v5 更新** — dependabot **PR #13（OPEN）**：`js-yaml` 4.3.0 → 5.2.0。破壊的変更の確認待ち
  （※ 完了済みの roadmap 内部番号 #13＝diagram-edit とは別物）。
- **GitHub Actions 再有効化（要対応）** — 現在も `actions/permissions` は `{"enabled": false}`（2026-07-04 API 確認済み）。
  `ci.yml` は concurrency＋npm キャッシュ導入済みだが、**Tauri build の 3-OS マトリクスが push/PR 毎に走る**（要
  release/tag 限定）＋ push を Linux のみに絞る、が残タスク。軽量化後に再有効化。再有効化まで mac 署名 P6 実機検証
  （[[llamafile_runtime_design]]）はブロック。**同時に F4 残：npm audit high を required 化＋`continue-on-error` 見直し**
  （npm high は `mermaid→chevrotain→lodash-es`＝runtime 到達を優先・[ADR-0016](adr/0016-security-review-theme4.md) F4）。開発メモリ `ci_actions_billing`。
- **セキュリティ是正の実機検証** — F3（OS keychain・実装 PR #66）の**実 keychain 往復が WSL 開発機で未確認**＝
  Windows/macOS 実機で保存/読み出しを要検証（[ADR-0016](adr/0016-security-review-theme4.md) F3）。
- **実験用一時ファイルの後始末** — テンプレ検証・headless 生成で散らかった temp 出力（`_probe.ts`・未追跡 `.potx` 等）を整理（↑「テンプレ資産の棚卸」と関連）。
- **column 内 table の認識（小改修）** — separator レイアウト（col/card/kpi/step）の各カラムは図（```diagram/mermaid```）は拾うが **GFM テーブルは本文テキスト化**（`extractFencedBlock` のみ・`findTableInLines` 未適用）。列内テーブルを native table として拾う（[ADR-0020](adr/0020-image-embedding.md) 敵対レビューで確認・画像とは独立）。触点: `md-slide-parser.ts` separator 分岐。
- **最背面画像のプレビュー直接ドラッグ（小）** — 最背面レイヤーはハンドルが content の下に隠れるため現状フォーム編集のみ。編集 chrome（枠線＋角ハンドル）だけを前面 overlay 化してドラッグ/リサイズを再有効化（[ADR-0020](adr/0020-image-embedding.md)）。
