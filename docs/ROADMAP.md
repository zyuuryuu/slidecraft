# SlideCraft ロードマップ

前方向きの計画のみを記す。完了フェーズの履歴は **ADR ＋ git（PR）** に移管済み。決定の記録は `docs/adr/` を参照。

**現在地（2026-07-04）**：土台（テンプレ堅牢性）・差別化アーキ（内蔵 AI＝llamafile 同梱 P1〜P6）・
**プロンプト磨き込み**（構造ヘッダー保全 [ADR-0012](adr/0012-ai-edit-structure-preservation.md)、敵対検証ハードニング、
生成 payload 保全 #12、design-op 告知 #13、テキストスライドへ図追加 #3B、図生成の二段構え、プロンプト整合 #3・#1）
まで完了（PR #58）。**UI 磨き込み**（AI Assist＋協働を1つの ✨AI ドックにタブ統合・マスターピッカーを Top/Draft 共通の
単一プルダウンに刷新・Draft ヘッダ整理）も反映（PR #59）。機能フェーズは **テーマ1「HTML 出力」**
（MVP・表現力・印刷/PDF 堅牢化・図テキスト SVG `<text>` 統一 [ADR-0013](adr/0013-svg-native-text.md)・PR #60–#63）と
**テーマ2「テンプレ作成補助」**（[ADR-0014](adr/0014-template-authoring.md)）・**テーマ3「MCP ブラッシュアップ」**
（[ADR-0015](adr/0015-mcp-brushup.md)）・**テーマ4「セキュリティレビュー」**（監査完了・[ADR-0016](adr/0016-security-review-theme4.md)）が完了。
**named 主要テーマ 1〜4 は全て完了**（テーマ4 の是正 F1〜F4 はバックログ）。詳細は開発メモリ `html_output_design` / `roadmap_post_p2`。

---

## 次の主要テーマ（優先順）

**named 主要テーマ（1〜4）は全て完了。** 残りは下記バックログ（＝テーマ4 監査で確定した是正 F1〜F4 を含む）と運用項目。

> テーマ1「HTML 出力」（大マイルストーン）は **完了**（2026-07-04・[ADR-0013](adr/0013-svg-native-text.md)・
> 設計＝[docs/design/html-output.md](design/html-output.md)）。MVP＋表現力（遷移/オーバービュー/選択UI）＋
> 印刷/PDF 堅牢化（1枚1ページ・背景印刷・図テキスト SVG `<text>` 統一）まで main（PR #60–#63・実 PDF 検証済み）。
> 後続の磨き込み（図/テンプレ品質・CJK フォント埋め込み・印刷 e2e）はバックログ参照。

> テーマ2「テンプレ作成補助」は **完了**（2026-07-04・[ADR-0014](adr/0014-template-authoring.md)・
> 設計＝[docs/design/template-authoring.md](design/template-authoring.md)）。後続の小粒タスクはバックログ参照。

> テーマ3「MCP ブラッシュアップ」（上流 AI の作業性向上）は **完了**（2026-07-04・[ADR-0015](adr/0015-mcp-brushup.md)・
> 設計＝[docs/design/mcp-brushup.md](design/mcp-brushup.md)・使い方＝[docs/mcp-server.md](mcp-server.md)）。監査（35 findings）
> ＋ユーザ insight で手前半（自己記述オーサリング契約＋テンプレ調達）を最優先化し S1–S6 実装：`get_authoring_guide`/図の二段
> ガイド・`create_template`・統一 mutation envelope＋collab no-op バグ修正・構造操作（insert/delete/move/duplicate）・
> `get_slide`＋text スライドへ図追加・決定論 hints＋split の changedSlides。各スライスを敵対レビュー通過（全 982 tests・
> schema 変更なし）。後続の小粒（S2 増分2＝`list_/use_template`）はバックログ参照。

> テーマ4「セキュリティレビュー」（配布/自動化前提の全面監査）は **監査完了**（2026-07-04・[ADR-0016](adr/0016-security-review-theme4.md)・
> [ADR-0010](adr/0010-security-model.md) を supersede せず補追）。5 サーフェス並列 read-only 監査（MCP＋協働ホスト／BYOK＋egress／
> Tauri backend＋モデルDL／供給網＋CI／XSS＋untrusted 入力）で **ADR-0010 の中核ガードは実挙動として成立を確認**（token 境界・
> loopback・no-fs・zip 硬化・spawn 安全・モデルDL整合性・prototype 汚染不発）。検出した是正 **F1〜F4 はコード未実装＝下記バックログ**
> に起票（ユーザ選択＝レポート＋ADR 記録に留め、実装は後続）。詳細は [ADR-0016](adr/0016-security-review-theme4.md)。

> **既知の仕様（非バグ・再調査不要）**：表セル文字・図ノード文字は独立図形のため、スライドマスター body 書式には非追従（継承対象外）。

---

## バックログ（将来）

| 項目 | 内容 | サイズ |
| --- | --- | --- |
| 🔒 セキュリティ F1（egress）｜HIGH | 実 egress ゲートは webview CSP でなく `http:default` capability（plugin-http は CSP 迂回）＝現状 `https://**` 全開放。**既定を CSP 一致の固定 allowlist に**（3 AI API＋`huggingface.co`＋`cdn-lfs*.huggingface.co`〔モデルDL の LFS CDN 302 先〕＋loopback）＋`baseURL` https-only 検証。**任意 custom は明示 opt-in で http scope を動的拡張**（blanket 撤廃）。詳細＝[ADR-0016](adr/0016-security-review-theme4.md) F1。触点: `src-tauri/capabilities/default.json`・`src/ipc/{ai,openai-compat}.ts`・設定 UI | M |
| 🔒 セキュリティ F2（svgCache XSS）｜HIGH | 永続 `mermaidBlock.svgCache`（untrusted `deck.json` 文字列）が `mermaid.render()` を経ず `dangerouslySetInnerHTML` へ直行（`SlidePreview.tsx:68`）＋**エクスポート HTML に CSP 無し**（`html-shell.ts`）で共有先発火。**root-cause＝open 時に svgCache 破棄/再計算**＋エクスポート shell に CSP `<meta>`＋SlideCard SVG sink を DOMPurify。[ADR-0016](adr/0016-security-review-theme4.md) F2 | S〜M |
| 🔒 セキュリティ F3（キー at-rest）｜MED | BYOK キーが localStorage 平文（`useAiGeneration.ts:325`）＝XSS→キー窃取の増幅路。中期＝キーを JS 到達不能ストア（Rust IPC / stronghold / OS keychain）へ移動。当面＝`rememberKey` 既定 off 寄せ検討。[ADR-0016](adr/0016-security-review-theme4.md) F3 | M |
| 🔒 セキュリティ F4（供給網・小粒）｜LOW | `stage-node.mjs` に SHA256 チェック追加（`stage-llamafile.mjs` 準拠）・`esc()`（`svg-writer.ts:38`）に `'`→`&#39;`・fs capability の `allow-remove`/`allow-mkdir` 削減検討・CI 再有効化時に npm audit high を required 化＋両 audit の `continue-on-error` 見直し・npm high は `mermaid→chevrotain→lodash-es`（runtime 到達）優先。[ADR-0016](adr/0016-security-review-theme4.md) F4 | S |
| MCP: テンプレ選択（S2 増分2） | `list_templates`/`use_template(id)` で登録済みテンプレを AI が選べるように。GUI の master レジストリ（`useMasterRegistry`/`src/ipc/master-store.ts`＝Tauri fs 裏）を `HostContext` に accessor 注入する host 機能で GUI 側実装と対。stdio は `create_template`／bytes 持参で代替可。[ADR-0015](adr/0015-mcp-brushup.md) の残タスク | S〜M |
| MCP: エラー契約の完全統一 | ガード系 throw（範囲外 index・未オープン）を `{ok:false, error, code?}` に寄せ、`isError` を un-modeled crash 専用に。現状はドメイン拒否＝`{ok:false}`／呼び出し・クラッシュ＝`isError` の2カテゴリで運用（`docs/mcp-server.md` に明記済） | S |
| HTML出力: 図/テンプレ品質の磨き込み | 実レンダ敵対監査（全30枚・Playwright→エージェント目視）で検出。**共有エンジン由来でプレビュー/PPTX にも出る既存問題**：図のエッジ/関係ラベルが**低コントラスト＋ノード衝突＋折返し**（最頻・効き目大／`diagram-painter` 系）・**閉じスライドが白地に薄色文字で不可視**（Closing レイアウトの背景抽出）・レーダー等の**図タイトルがヘッダと重複**（`omitTitle` 未効き疑い）。共有 painter/テンプレ抽出に触る＝PPTX にも波及（golden 検証必須）。監査 harness は再利用可（`html_output_design`） | M |
| HTML出力: @font-face CJK 埋め込み（設計 S7） | Noto Sans/Serif JP サブセットを data URI 内蔵しクロスマシン完全再現（現状は順序付きフォールバックスタック）。前提＝`<a:ea>` フォント抽出＋明朝/ゴシック分類。サブセット化ツールが新規に必要 | M |
| HTML出力: 印刷の恒久 e2e テスト | Playwright `page.pdf` でページ数/向き/背景を自動検証し実出力を仕組みで担保（[[feedback_verify_real_output]]） | S |
| テンプレ生成の実機確認（残り＝PowerPoint 開封のみ） | **2026-07-04 実施済み**: 多レンズ構造検証（expat 整形式・python-pptx 完全開封・rels/Content-Types 整合、`tests/pptx-wellformed.test.ts` / `template-writer-conventions.test.ts` で恒久ゲート化）＋実アプリ取り込みをユーザ確認。副産物として canonical の整形式破損を発見・根絶（`31c556e`）。**残り**: PowerPoint 実機での開封/見た目確認 — 開発機に PowerPoint 無し。PowerPoint for the web（OneDrive にファイルを置いて office.com で開く）か PowerPoint のある別マシンで。Tauri 実機のレジストリ永続化 E2E も同時に | S |
| 内蔵 30 レイアウトのオミット | Midnight Executive 30 種は**開発用** — 主要テーマ（＋一部バックログ）完了後にビルトイン同梱をやめ、canonical .pptx は入力サンプルとしてリポジトリ内に残置。触点: `useMasterRegistry` の `BUILTIN_URL`＋起動 fetch（→ 残置サンプル参照 or `writeTemplate` で起動時生成）・`BUILTIN_LAYOUTS` の既定セット差し替え・`LAYOUT_NAMES` フォールバックの整理・テスト fixture パス・`scripts/rebuild-template.ts` 引退。ランタイムはロールベースで 30 種非依存（alien テストでゲート済み）のため作業はこの触点に閉じる | S〜M |
| テンプレ作成の後続 UI | 作成モーダルの埋め込みライブプレビュー・レイアウトサブセット選択・カスタムレイアウト定義 | M |
| useAiGeneration 分割 | 554 行（400 行ルール超過・テーマ2 S5 で +9）。config/接続まわりとタスク実行の分離 | S〜M |
| 自動アップデート | Tauri Updater 経由（GitHub Releases） | M |
| アプリアイコン正式デザイン | 仮アイコン（青背景 "S"）を正式版へ差し替え | S |
| UI 日英表記切り替え（i18n） | UI 文言の 日本語⇄英語 トグル。現状は日本語ハードコード → 文字列を抽出し言語切替を提供（ユーザ要望） | M〜L |
| 画面の色調モード切替（Dark/Light/Modern） | アプリ UI の配色を Dark（現状）/Light/Modern で切替。ハードコード色（`bg-[#1E2761]` 等）をトークン化（CSS 変数 / Tailwind テーマ）＋トグル（ユーザ要望） | M〜L |
| 編集画面: Layout と Placeholder の視覚区別 | Slide Editor（フォーム）で **Layout（＝構造/メタ属性：どのマスターレイアウトか）** と各 **Placeholder（＝内容フィールド）** が同じ体裁で縦並びになり性質差が伝わりにくい。セクション分け/見出し/色分け等で属性の違いを明確化（ユーザ要望・`SlideEditor.tsx`） | S〜M |
| 画像の Markdown 埋め込み | `![alt](path)` の画像埋め込み（**チャートは ```diagram``` の xychart/radar/kpi/pie で対応済み**、残りは画像のみ） | M |
| テンプレ資産の棚卸 | `public/templates/slide/` に `.potx`（未追跡6）＋`_全レイアウト見本.pptx`（tracked）が堆積。**アプリが束ねる built-in は canonical `Midnight_Executive_30_TemplateOnly.pptx` 1本のみ**（ディレクトリ列挙なし）。棚卸：参照ゼロの見本7件＋未追跡 `.potx` を「テンプレ管理」機能で**束ねる(A)** か **整理/削除(B)** か決定。将来案：データを **`.potx` 形式に一本化**（見本は生成 or 廃止）。⚠ **テスト fixture（`lrk-slides-velis_CC0`／`報告書テンプレート_全レイアウト見本`／`配布資料_公文書高密度_全レイアウト見本`／`報告書テンプレート_官公庁_全レイアウト見本`）は削除不可**。レジストリ永続化はテーマ2 S6 で実装済み — その後続として着手 | S |
| ユーザ利用ガイド | 図 14 種・二段階編集・テンプレ流し込みを網羅したオンボーディング | M |
| 生成の encoding 事故を構造で抑止（#12-D） | 弱モデルの `\uXXXX` 違反を**発生させない**根本抑止。案：(D-1) 生成を per-slide 分割し違反の被害半径を1枚に＋壊れた1枚だけ再試行（`extractSlidePlan` 既存）／(D-2) 本文を JSON 文字列から出しエスケープ不要な形式へ。現状は floor（違反破棄＋告知＝#12-5 C）で担保済。着手時に設計 | M |
| 図編集 diff の見た目 | AI 図編集（diagram-edit）の変更プレビューが「フル Markdown vs 生 YAML」比較で見た目がズレる。図編集時は YAML 同士で diff（採用の動作は 6d036d1 で修正済・これは cosmetic） | S |
| フィールドクリアで空 ph が残る | 欄をクリアすると空パラグラフの placeholder がモデルに残る（1:1 には無害・export cleanliness の観点で将来検討） | S |
| serializer: 単独 content スライドが空出力 | index 0 の content スライドが autoSelect で Title 扱いになり、title(idx15) を idx0 として読むため空シリアライズ。`currentSlideMd` は解決済レイアウトをピンして回避済だが `serializeMd` 直呼びで露出 | S |

---

## 保留中の依存・運用

- **js-yaml v5 更新** — dependabot **PR #13（OPEN）**：`js-yaml` 4.3.0 → 5.2.0。破壊的変更の確認待ち
  （※ 完了済みの roadmap 内部番号 #13＝diagram-edit とは別物）。
- **GitHub Actions 再有効化（要対応）** — 現在も `actions/permissions` は `{"enabled": false}`（2026-07-04 API 確認済み）。
  `ci.yml` は concurrency＋npm キャッシュ導入済みだが、**Tauri build の 3-OS マトリクスが push/PR 毎に走る**（要
  release/tag 限定）＋ push を Linux のみに絞る、が残タスク。軽量化後に再有効化。再有効化まで mac 署名 P6 実機検証
  （[[llamafile_runtime_design]]）はブロック。開発メモリ `ci_actions_billing`。
- **実験用一時ファイルの後始末** — テンプレ検証・headless 生成で散らかった temp 出力を整理（↑「テンプレ資産の棚卸」と関連）。
