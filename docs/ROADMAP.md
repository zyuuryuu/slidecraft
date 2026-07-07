# SlideCraft ロードマップ

**前向きの計画のみ**を記す。実装済みの履歴は **[shipped.md](shipped.md)**、決定の記録は [docs/adr/](adr/)、詳細な経緯は git（PR）を参照。

**現在地（2026-07-07）**：**v0.1.0 出荷済**（初回パブリックリリース — 工程化 M0–M13 完了・[shipped.md](shipped.md)）。以降 v0.1.x で**第三者マスター対応**（Re-make／素マスターの本文束縛／プレビュー画像描画）＋**MCP CLI 同梱**（ビルド不要のエージェント駆動）を積み増し。**いま：次バージョンのリリース準備。** 残る細部は「リリース後の残タスク」、将来テーマは「バックログ」へ。

> **既知の仕様（非バグ・再調査不要）**：表セル文字・図ノード文字は独立図形のため、スライドマスター body 書式には非追従（継承対象外）。

---

## 🔻 リリース後の残タスク（v0.1.x）

v0.1.0 の工程化フェーズ（M0–M13）は完了（[shipped.md](shipped.md)）。残る細部のみ：

| 項目 | 内容 | 状態 |
| --- | --- | --- |
| 本アプリアイコン | 仮の青地「S」→ 正式デザイン確定 → `tauri icon` で全形式/サイズ再生成 | 💬 DISCUSS（要ユーザ） |
| PowerPoint 実機開封チェック | 生成 PPTX を実 PowerPoint / PowerPoint for the web で開き見た目確認（現状 python-pptx＋wellformed-gate のみ） | ✅ READY |
| Intel Mac (.dmg) | v0.1.0 は runner 都合で arm64 のみ。x64 dmg 生成後に cask の on_arm/on_intel 分割を復活＋`update-cask` を 2-sha へ | 🔗 DEPENDS（runner） |
| 通知バナー（軽量自動更新） | 方針は [ADR-0021](adr/0021-auto-update-strategy.md) で決定済。GitHub Releases API ポーリングで「新版あり」通知（CSP egress＋版数取得＋実ポーリング検証を要す） | ✅ READY |
| 不可視の締めスライド（旧 M11 BUG1） | Closing レイアウトが白地に薄色文字で不可視（背景/コントラスト抽出）。「図/テンプレ品質磨き込み」の一部 | ✅ READY |
| アプリ内 Help/? 導線 | opener プラグイン未配線 → ドキュメントサイトへ誘導 | 🔗 DEPENDS |

---

## バックログ（将来）

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
| プレビュー図形描画の残（グループ / arcTo / グラデ） | preset 図形（楕円・矢印・三角ほか）・custGeom パスは SVG 描画済（c1d5423）。残：**グループ図形（`<p:grpSp>`）** は子図形の座標変換（chOff/chExt→off/ext）が要り現状は矩形化 or 脱落（velis に 28 個）／custGeom の **arcTo セグメント**は変換 skip 中／**グラデ塗り（`gradFill`）** はフラット単色化。触点: `template-loader.ts extractDecorations`（grpSp は再帰抽出＋座標変換）・`SlidePreview.tsx renderDeco`。プレビュー限定（PPTX はネイティブなので不変） | S〜M |

### 📄 テンプレ / マスター

| 項目 | 内容 | サイズ |
| --- | --- | --- |
| 内蔵 30 レイアウトのオミット | Midnight Executive 30 種は**開発用** — 主要テーマ（＋一部バックログ）完了後にビルトイン同梱をやめ、canonical .pptx は入力サンプルとしてリポジトリ内に残置。触点: `useMasterRegistry` の `BUILTIN_URL`＋起動 fetch（→ 残置サンプル参照 or `writeTemplate` で起動時生成）・`BUILTIN_LAYOUTS` の既定セット差し替え・`LAYOUT_NAMES` フォールバックの整理・テスト fixture パス・`scripts/rebuild-template.ts` 引退。ランタイムはロールベースで 30 種非依存（alien テストでゲート済み）のため作業はこの触点に閉じる | S〜M |
| テンプレ資産の棚卸 | `public/templates/slide/` に `.potx`（未追跡6）＋`_全レイアウト見本.pptx`（tracked）が堆積。**アプリが束ねる built-in は canonical `Midnight_Executive_30_TemplateOnly.pptx` 1本のみ**（ディレクトリ列挙なし）。棚卸：参照ゼロの見本7件＋未追跡 `.potx` を「テンプレ管理」機能で**束ねる(A)** か **整理/削除(B)** か決定。将来案：データを **`.potx` 形式に一本化**（見本は生成 or 廃止）。⚠ **テスト fixture（`lrk-slides-velis_CC0`／`報告書テンプレート_全レイアウト見本`／`配布資料_公文書高密度_全レイアウト見本`／`報告書テンプレート_官公庁_全レイアウト見本`）は削除不可** | S |
| スライドマスター Re-make の残（本体は [shipped](shipped.md)） | Re-make 本体（テーマ抽出→自前レイアウト・ロゴ継承・フラット設計吸収・純粋 Import 両立）は出荷済（[ADR-0023](adr/0023-third-party-master-idx-convention.md)）。残る磨き込み：**(A) EA/CJK フォント分類**（`<a:ea>` 抽出＝latin 名流用の解消）・**(B) dark ロゴ変種の per-background 選択**（現状は最頻1枚）。関連 [[third_party_master_idx_fix]] | S |

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
- **未追跡テンプレ資産** — `public/templates/slide/` に会社系 `.potx`（未追跡6）＋`CX_sample_MSGothic.pptx`（gitignore 済のローカル fixture）が残置。↑「テンプレ資産の棚卸」で束ねる/整理を決める（scratch の一時テストは都度削除済）。
- **column 内 table の認識（小改修）** — separator レイアウト（col/card/kpi/step）の各カラムは図（```diagram/mermaid```）は拾うが **GFM テーブルは本文テキスト化**（`extractFencedBlock` のみ・`findTableInLines` 未適用）。列内テーブルを native table として拾う（[ADR-0020](adr/0020-image-embedding.md) 敵対レビューで確認・画像とは独立）。触点: `md-slide-parser.ts` separator 分岐。
- **最背面画像のプレビュー直接ドラッグ（小）** — 最背面レイヤーはハンドルが content の下に隠れるため現状フォーム編集のみ。編集 chrome（枠線＋角ハンドル）だけを前面 overlay 化してドラッグ/リサイズを再有効化（[ADR-0020](adr/0020-image-embedding.md)）。
- **ステップ/グループセル内の Markdown 整形（要調査）** — separator レイアウト（`<!-- step -->` 等）の各セル内で `## 見出し` が生の `##` のまま表示され、箇条書きの記号（`-`）も落ちて見える（プレビュー実レンダで確認・図形描画の検証中に発見）。セル本文を素テキスト化しているためと推測。**仕様か不具合か切り分けが要る**。触点: `md-slide-parser.ts` の separator 分岐＋group セルのレンダリング。
