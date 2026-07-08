# SlideCraft ロードマップ

**前向きの計画のみ**を記す。実装済みの履歴は **[shipped.md](shipped.md)**、決定の記録は [docs/adr/](adr/)、詳細な経緯は git（PR）を参照。

**現在地（2026-07-08）**：**v0.2.1 publish 済み**（[CHANGELOG](../CHANGELOG.md)・[shipped.md](shipped.md)／Homebrew cask も更新・`brew upgrade` の "already a Binary" 修正済み）。v0.2.0（第三者マスター対応＋MCP CLI 同梱）に続き、**UI 日英切替（i18n・全 UI ＋ .ts 状態文言）＋英語ドキュメント（VitePress 二言語サイト）**、**`.scft` 関連付け＋拡張子短縮**、**AI 協働 Deck の背景タブ化**、**プレビュー描画の忠実化**、**公式ビルトインテンプレ4本化＋衛生整理**、**空起動**を同梱。**v0.2.1 後の main（未リリース）**: 依存脆弱性 6→2 解消（vitepress 2.x／rand・残は Tauri スタック固定）、**Placeholder ロールの gate 付き title リカバリ（[ADR-0025](adr/0025-placeholder-role-resolution.md)）**、e2e スイートを空起動＋i18n に追随（CI 全 green）、`examples/`→`samples/` 統合、**Windows コード署名＝SignPath Foundation で方針確定・申請下地整備済（審査待ち／下記）**。残る細部は「リリース後の残タスク」、将来テーマは「バックログ」へ。

> **既知の仕様（非バグ・再調査不要）**：表セル文字・図ノード文字は独立図形のため、スライドマスター body 書式には非追従（継承対象外）。
>
> **検証で棄却（他AIレポート・敵対検証 2026-07-07／再調査不要）**：(B2) `get_deck_issues` 長い箇条書き過検知＝**非バグ**（検知は `deck-diagnostics.ts` の `SENTENCE_BULLET=28`、報告の `charsPerBullet:59` は検知経路に入らない別 budget＝`slide-fix.ts` の AI 指示値）／(B3) 空本文スライド未検出＝**意図的な仕様**（title-only は正当な内容・追加は区切り/表紙/空カラムの誤検知リスクで要決定の機能追加）／(A4) 大規模テンプレのロール推定ズレ＝広域主張（56枚規模・表/図/チャートが丸められる・文字数過大）は**偽**（tbl/chart/pic は idx 分岐より先に尊重）。実在は [ADR-0023](adr/0023-third-party-master-idx-convention.md) 既知エッジ（規約 opt-in マスタの body@idx15/16 誤分類）のみで、**素朴な typed-title ゲート修正は同梱テンプレ（00_表紙の会議名=body@15）を退行**させるため不可。

---

## 🔻 リリース後の残タスク（v0.1.x）

v0.1.0 の工程化フェーズ（M0–M13）は完了（[shipped.md](shipped.md)）。残る細部のみ：

| 項目 | 内容 | 状態 |
| --- | --- | --- |
| 本アプリアイコン | 仮の青地「S」→ 正式デザイン確定 → `tauri icon` で全形式/サイズ再生成 | 💬 DISCUSS（要ユーザ） |
| **Windows コード署名（Authenticode／SignPath Foundation）** | **方針確定＝SignPath Foundation（OSS 向け無料 OV Authenticode）**。実ユーザが SmartScreen「不明な発行元」でブロックされる問題への恒久策。**申請下地は整備済**（2026-07-08・commit 5b58645）: `CODE_SIGNING_POLICY.md`（署名対象/ビルド&署名フロー/鍵=SignPath HSM/役割/配布・申請中 posture）・`CODE_OF_CONDUCT.md`・`SECURITY.md`・`CONTRIBUTING.md`・issue/PR テンプレ・README 日英の署名節を追加、v0.2.1 公開リリースで「無料 DL 可能」も充足。**残**: (1) [signpath.org/apply](https://signpath.org/apply.html) へ申請、(2) 承認後に `release.yml` へ `signpath/github-action-submit-signing-request` を配線（tag 限定・鍵は先方 HSM・CI は API トークンのみ）しポリシーを実装済みへ更新。鍵は先方管理で公開実績により SmartScreen 評価が蓄積（EV より遅いが「不明な発行元」は解消）。棄却した代替: Azure Trusted Signing（要組織/本人確認）・OV/EV 有償証明書。→ 承認後に ADR 化 | 🔗 DEPENDS（SignPath 審査待ち） |
| Intel Mac (.dmg) | v0.1.0 は runner 都合で arm64 のみ。x64 dmg 生成後に cask の on_arm/on_intel 分割を復活＋`update-cask` を 2-sha へ | 🔗 DEPENDS（runner） |
| 通知バナー（軽量自動更新） | 方針は [ADR-0021](adr/0021-auto-update-strategy.md) で決定済。GitHub Releases API ポーリングで「新版あり」通知（CSP egress＋版数取得＋実ポーリング検証を要す） | ✅ READY |
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
| 図品質の磨き込み（残＝ノード衝突/折返し） | 実レンダ敵対監査（全30枚）で検出した既存問題のうち、**エッジラベル低コントラスト（82569eb／PR #83）と図タイトル重複 `omitTitle`（59ef092）は出荷済**（→[shipped](shipped.md)）。**閉じスライドは非バグと判明**（canonical Closing は full-bleed 濃紺 BG 図形を持ち可読・監査で reconcile 済→shipped）。残＝**ノード衝突＋ラベル折返し**（`layout-engine` は固定 node_width＋全体スケールのみ・最頻/効き目大・未対処）。共有 painter に触る＝PPTX にも波及（golden 検証必須）。触点: `diagram-painter`・`layout-engine` | M |
| @font-face CJK 埋め込み（設計 S7） | Noto Sans/Serif JP サブセットを data URI 内蔵しクロスマシン完全再現（現状は順序付きフォールバックスタック）。前提＝`<a:ea>` フォント抽出＋明朝/ゴシック分類。サブセット化ツールが新規に必要 | M |
| **プレビュー/HTML の PPTX 追随（SmartArt・複雑図形）** | プレビュー/HTML は共有 SlideCard レンダラで PPTX と WYSIWYG のはずだが、**テンプレ由来の図形描画にまだ追随不足**の疑い（ユーザ体感 2026-07-08）。特に **SmartArt（`<dgm:>`/graphicFrame の diagram パート）は未描画の見込み**、加えて connector・WordArt・複雑 custGeom・グループのネスト等。まず**ギャップの実測**（実テンプレ群を Playwright 実レンダ→PPTX と目視差分＝敵対監査）→ 高インパクト分から共有レンダラ（`ooxml-geom`/`ooxml-fill`/SlideCard）で closing。SmartArt は dgm→図形ツリー展開が要る大物なので別 phase。プレビュー/HTML 限定なら PPTX golden 非影響（ただし共有 painter に触る変更は golden 検証必須）。関連 [[diagram_render_architecture]] | M〜L |

### 📄 テンプレ / マスター

| 項目 | 内容 | サイズ |
| --- | --- | --- |
| 内蔵 30 レイアウトのオミット | Midnight Executive 30 種は**開発用** — 主要テーマ（＋一部バックログ）完了後にビルトイン同梱をやめ、canonical .pptx は入力サンプルとしてリポジトリ内に残置。触点: `useMasterRegistry` の `BUILTIN_URL`＋起動 fetch（→ 残置サンプル参照 or `writeTemplate` で起動時生成）・`BUILTIN_LAYOUTS` の既定セット差し替え・`LAYOUT_NAMES` フォールバックの整理・テスト fixture パス・`scripts/rebuild-template.ts` 引退。ランタイムはロールベースで 30 種非依存（alien テストでゲート済み）のため作業はこの触点に閉じる | S〜M |
| スライドマスター Re-make の残（本体は [shipped](shipped.md)） | Re-make 本体（テーマ抽出→自前レイアウト・ロゴ継承・フラット設計吸収・純粋 Import 両立）は出荷済（[ADR-0023](adr/0023-third-party-master-idx-convention.md)）。残る磨き込み：**(A) EA/CJK フォント分類**（`<a:ea>` 抽出＝latin 名流用の解消）・**(B) dark ロゴ変種の per-background 選択**（現状は最頻1枚）。関連 [[third_party_master_idx_fix]] | S |
| **AI による非決定 Re-make（第3の取り込み口）** | 現状の取り込みは①丸ごと忠実 ②決定論 Re-make（テーマ抽出→自前レイアウト）の2択。乱雑な第三者マスターは**ヒューリスティックで“解釈”する（ロール/レイアウト分類のズレ＝ADR-0025・Tier1/2 で継続対処中）**のが宿命。**代わりに AI に整った `TemplateSpec` を“再著述”させる**第3口を足すと、不整合を**根から回避**できる可能性。設計方針：決定論抽出（フォント/配色/ロゴ/レイアウト意図）で seed → **AI が曖昧なロール割当・レイアウト構成のみ再構成** → **既存の template 検証ゲート＋validate-and-retry（[ADR-0018](adr/0018-validation-at-adoption-gate.md)）で担保**、contrast-guard は既存流用。[ADR-0014](adr/0014-template-authoring.md)（AI が spec 提案）＋[ADR-0023](adr/0023-third-party-master-idx-convention.md)（決定論 Re-make）の自然な合流。ローカル小モデルで足りるか（harness-over-model・[[product_philosophy_harness]]）は要検証。着手時に ADR。（ユーザ発案 2026-07-08） | M〜L |

### 🖥 UX / オンボーディング / 配布

| 項目 | 内容 | サイズ |
| --- | --- | --- |
| 完全な署名付き自動アップデート | 初回は軽量通知（M12）で代替。出荷後：`tauri signer` 署名鍵ペア＋`plugins.updater`＋4-OS の `latest.json` 集約＋draft/publish フロー再設計。鍵は回転不可の不可逆判断（ADR 化） | M |

### 🔒 セキュリティ

| 項目 | 内容 | サイズ |
| --- | --- | --- |
| F1'（egress hard boundary）｜LOW（保留） | 保留（F2 で前提縮小）：`http:default` の `https://**` を CSP 一致 allowlist（3 AI API＋`huggingface.co`＋`cdn-lfs*.huggingface.co`〔モデルDL の LFS CDN 302 先・含めないと DL 破綻〕＋loopback）に縮小し、承認済み custom host を **Rust 側 egress ゲート**（reqwest・host allowlist 強制）で通す実境界化。streaming fetch の Rust 越し再実装を要し大きめ。触点: `src-tauri/capabilities/default.json`・Rust command・`src/ipc/app-fetch.ts` | M |

---

## 保留中の依存・運用

- **js-yaml v5 更新** — dependabot **PR #13（OPEN・未 merge）**：`js-yaml` 4.3.0 → 5.2.1（メジャー）。破壊的変更の確認待ち。
- **依存の脆弱性アラート（2026-07-08・6件中5件解消）** — **npm 4件**（`vite` high `server.fs.deny` bypass ＋ medium×2・`esbuild` medium）は `vitepress` 1.6.4→**2.0.0-alpha.18** で解消（v2 は vite@8 を使い、アプリ既存の vite@8/esbuild@0.28 に dedup＝脆弱な vite@5.4.21/esbuild@0.21.5 が消滅・`npm audit`=0・docs:build/二言語スイッチャ検証済）。**`rand`（low）**は `cargo update` で 0.8.5→0.8.6。**残 1件＝`glib`（medium・0.18.5→0.20.0）**は gtk-rs/Tauri スタックに固定され単独更新不可＝**Tauri の GTK バインディング更新待ち**（Linux GTK の iterator 健全性・実害小）。※vitepress は現状 2.x が alpha（`next` タグ）＝docs ツールのみ・出荷物非影響。stable 化したら追随。dependabot PR #86（minor-patch 群）/#13（js-yaml メジャー）は別途。
- **`.scft` 形式バージョニングの活用（前方互換保険）** — バンドルへの schema version 埋め込み**自体は実装済**（`project-io.ts` の `meta.json.version`=`PROJECT_VERSION`・zod 検証・→[shipped](shipped.md)）。残＝**開封時に version を使った互換ゲート/マイグレーションが未実装**（現状 `openProject` は不一致でも黙って既定へフォールバック＝保険が効いていない）。着手時に「新しい version は拒否 or 移行」を追加。触点: `project-io.ts openProject`。
- **会社 `.potx` / CX の保管** — 会社系 `.potx`（7本）＋`CX_sample_MSGothic.pptx` は `tests/fixtures/templates/` に置き **gitignore**（知財・ローカル限定・skipIf テストのみ参照）。棚卸＋公式昇格＋public 退避は完了（→[shipped](shipped.md)）。
- **column 内 table の認識（要注意・小改修ではない）** — separator レイアウトの各カラムは図（```diagram/mermaid```）は拾うが **GFM テーブルは本文テキスト化**（`findTableInLines` 未適用）。**調査済（2026-07-07）**：`TableBlock` は既に `placeholderIdx` を持ち列スコープ可・パーサ側は数行追加で拾えるが、**シリアライザが `slide.table` を意図的に single-body 扱い**（`md-serializer.ts:195` `singleBodyFigure`＝パーサの table 再吸収を防ぐ設計）なので、素直に列 table を作ると round-trip で single-body に化ける。正しく直すにはシリアライザの separator 分岐で列位置に table を emit（diagram/mermaid の :215-222 と同様）＋`singleBodyFigure` ガードの見直しが要る。触点: `md-slide-parser.ts` 列 else 分岐＋`md-serializer.ts` separator 分岐。
- **混在スライドの本文＋表の同時保持（B1・他AI報告・敵対検証 2026-07-07）** — リード段落（非箇条書き）＋key-value 箇条書きの混在スライドで `convert_bullets_to_table` を掛けると、後段 `parseMd`（`md-slide-parser.ts` の table-vs-text 二択）がリード段落を**無言 drop**（never-silent 方針と不整合・undo 復旧可）。真因はツールでなく**共有パーサ**（同 drop は Markdown インポート等パーサ全経路で起こりうる）。診断が混在スライドで convert を推奨するのが引き金（`deck-diagnostics.ts:86` が bullet だけ数える）。根本策＝パーサが text+table 共存保持（共有経路・**golden 検証必須**）／安全策＝混在時は convert 非推奨 or ツールが警告返し。↑「column 内 table の認識」と同触点。
- **最背面画像のプレビュー直接ドラッグ（小）** — 最背面レイヤーはハンドルが content の下に隠れるため現状フォーム編集のみ。編集 chrome（枠線＋角ハンドル）だけを前面 overlay 化してドラッグ/リサイズを再有効化（[ADR-0020](adr/0020-image-embedding.md)）。
- **ステップ/グループセル内の Markdown 整形（要仕様判断）** — **原因特定済（2026-07-07）**：セルは `linesToParagraphs` を通り、(1) `## 見出し` は**リテラル表示**＝`linesToParagraphs` は `###`（3個）だけを heading 認識し `##`（2個）は素通り（`#`=タイトル/`##`=サブタイトル/`###`=グループ見出し という規約との齟齬）／(2) 箇条書きの `-` は `bullet:true` になるが、`SlidePreview.renderParagraph`（`para.bullet && bulletChar`）が**プレースホルダ style の `bulletChar` が空（buNone）だと記号を描かない**ため、列/セルの本文が「箇条書きなのに・が出ない」状態になる。どちらも**本文本体・round-trip に波及する仕様判断**（`##`→heading 化はシリアライザが `###` 正規化／bulletChar フォールバックはテンプレの buNone 意図と content 意図の衝突）。触点: `md-slide-parser.ts linesToParagraphs`・`SlidePreview.tsx renderParagraph`。
