# SlideCraft ロードマップ

**前向きの計画のみ**を記す。実装済みの履歴は **[shipped.md](shipped.md)**、決定の記録は [docs/adr/](adr/)、詳細な経緯は git（PR）を参照。

**現在地（2026-07-07）**：**v0.2.1 リリース**（タグ `v0.2.1`・installer ドラフト生成 → 実機レビュー後に publish／[CHANGELOG](../CHANGELOG.md)・[shipped.md](shipped.md)）。v0.2.0（第三者マスター対応＋MCP CLI 同梱）に続き、**UI 日英切替（i18n・全 UI ＋ .ts 状態文言まで）＋英語ドキュメント（VitePress 二言語サイト）**、**`.scft` 関連付け＋拡張子短縮**、**AI 協働 Deck の背景タブ化**、**プレビュー描画の忠実化**（背景画像・グラデ・非web画像→svgBlip・図形グラデ・グループ図形・custGeom 弧）、**公式ビルトインテンプレ4本化＋テンプレ資産の衛生整理**、**空起動**（＋空デッキ「＋」修正）、他AIレポートのトリアージ＋実バグ修正（B4 タブ名）を同梱。Windows 署名は保留。残る細部は「リリース後の残タスク」、将来テーマは「バックログ」へ。

> **既知の仕様（非バグ・再調査不要）**：表セル文字・図ノード文字は独立図形のため、スライドマスター body 書式には非追従（継承対象外）。
>
> **検証で棄却（他AIレポート・敵対検証 2026-07-07／再調査不要）**：(B2) `get_deck_issues` 長い箇条書き過検知＝**非バグ**（検知は `deck-diagnostics.ts` の `SENTENCE_BULLET=28`、報告の `charsPerBullet:59` は検知経路に入らない別 budget＝`slide-fix.ts` の AI 指示値）／(B3) 空本文スライド未検出＝**意図的な仕様**（title-only は正当な内容・追加は区切り/表紙/空カラムの誤検知リスクで要決定の機能追加）／(A4) 大規模テンプレのロール推定ズレ＝広域主張（56枚規模・表/図/チャートが丸められる・文字数過大）は**偽**（tbl/chart/pic は idx 分岐より先に尊重）。実在は [ADR-0023](adr/0023-third-party-master-idx-convention.md) 既知エッジ（規約 opt-in マスタの body@idx15/16 誤分類）のみで、**素朴な typed-title ゲート修正は同梱テンプレ（00_表紙の会議名=body@15）を退行**させるため不可。

---

## 🔻 リリース後の残タスク（v0.1.x）

v0.1.0 の工程化フェーズ（M0–M13）は完了（[shipped.md](shipped.md)）。残る細部のみ：

| 項目 | 内容 | 状態 |
| --- | --- | --- |
| 本アプリアイコン | 仮の青地「S」→ 正式デザイン確定 → `tauri icon` で全形式/サイズ再生成 | 💬 DISCUSS（要ユーザ） |
| **Windows コード署名（Authenticode）** | **実ユーザがインストール時にブロックされた**（SmartScreen「WindowsによってPCが保護されました」＝不明な発行元）。回避は「詳細情報→実行」だが離脱要因。※Let's Encrypt は **TLS 証明書専用でコード署名不可**（EKU/本人確認が別物）。選択肢: **(0・推奨) SignPath Foundation＝OSS 向け無料 OV Authenticode**（本プロジェクトは Apache-2.0＋公開リポで適格見込み。鍵は先方 HSM 管理・CI パイプラインに署名ステップを組込む。要申請・審査／OV なので SmartScreen 評価は DL 実績で蓄積するが「不明な発行元」ブロックは解消）／(1) Azure Trusted Signing ≈$10/月・要 登録3年以上の組織 or 本人確認／(2) OV 証明書 ≈$200-400/年／(3) EV 証明書 ≈$300-700/年・HSM＋組織・警告最速で消える／(4) 当面は**回避手順を install ガイドに明記**のみ。※updater の minisign 署名（↓）とは別物。→ ADR 化 | 💬 DISCUSS（推奨=SignPath 申請） |
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

### 📄 テンプレ / マスター

| 項目 | 内容 | サイズ |
| --- | --- | --- |
| 内蔵 30 レイアウトのオミット | Midnight Executive 30 種は**開発用** — 主要テーマ（＋一部バックログ）完了後にビルトイン同梱をやめ、canonical .pptx は入力サンプルとしてリポジトリ内に残置。触点: `useMasterRegistry` の `BUILTIN_URL`＋起動 fetch（→ 残置サンプル参照 or `writeTemplate` で起動時生成）・`BUILTIN_LAYOUTS` の既定セット差し替え・`LAYOUT_NAMES` フォールバックの整理・テスト fixture パス・`scripts/rebuild-template.ts` 引退。ランタイムはロールベースで 30 種非依存（alien テストでゲート済み）のため作業はこの触点に閉じる | S〜M |
| スライドマスター Re-make の残（本体は [shipped](shipped.md)） | Re-make 本体（テーマ抽出→自前レイアウト・ロゴ継承・フラット設計吸収・純粋 Import 両立）は出荷済（[ADR-0023](adr/0023-third-party-master-idx-convention.md)）。残る磨き込み：**(A) EA/CJK フォント分類**（`<a:ea>` 抽出＝latin 名流用の解消）・**(B) dark ロゴ変種の per-background 選択**（現状は最頻1枚）。関連 [[third_party_master_idx_fix]] | S |

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
- **依存の脆弱性アラート（2026-07-07・いずれもリリース非ブロッカー・容認）** — dependabot 6件。**dev scope 4件**＝`vite`（high: `server.fs.deny` bypass on Windows／medium×2）＋`esbuild`（medium・dev サーバ）で、**すべて `vitepress`/ビルドツール鎖の devDependency**（出荷アプリ・docs 静的出力には非含有／vite dev サーバは開発時のみ）。**runtime 2件**＝`rand`（low）・`glib`（medium）で **Tauri 経由の深い Rust 推移依存**（Tauri/Cargo 更新待ち）。dependabot **PR #86**（minor-patch 群・22件）は CI 失敗中で未 merge。解消はビルドツール鎖の更新 or Tauri bump 待ち。
- **`.scft` 形式バージョニングの活用（前方互換保険）** — バンドルへの schema version 埋め込み**自体は実装済**（`project-io.ts` の `meta.json.version`=`PROJECT_VERSION`・zod 検証・→[shipped](shipped.md)）。残＝**開封時に version を使った互換ゲート/マイグレーションが未実装**（現状 `openProject` は不一致でも黙って既定へフォールバック＝保険が効いていない）。着手時に「新しい version は拒否 or 移行」を追加。触点: `project-io.ts openProject`。
- **会社 `.potx` / CX の保管** — 会社系 `.potx`（7本）＋`CX_sample_MSGothic.pptx` は `tests/fixtures/templates/` に置き **gitignore**（知財・ローカル限定・skipIf テストのみ参照）。棚卸＋公式昇格＋public 退避は完了（→[shipped](shipped.md)）。
- **column 内 table の認識（要注意・小改修ではない）** — separator レイアウトの各カラムは図（```diagram/mermaid```）は拾うが **GFM テーブルは本文テキスト化**（`findTableInLines` 未適用）。**調査済（2026-07-07）**：`TableBlock` は既に `placeholderIdx` を持ち列スコープ可・パーサ側は数行追加で拾えるが、**シリアライザが `slide.table` を意図的に single-body 扱い**（`md-serializer.ts:195` `singleBodyFigure`＝パーサの table 再吸収を防ぐ設計）なので、素直に列 table を作ると round-trip で single-body に化ける。正しく直すにはシリアライザの separator 分岐で列位置に table を emit（diagram/mermaid の :215-222 と同様）＋`singleBodyFigure` ガードの見直しが要る。触点: `md-slide-parser.ts` 列 else 分岐＋`md-serializer.ts` separator 分岐。
- **混在スライドの本文＋表の同時保持（B1・他AI報告・敵対検証 2026-07-07）** — リード段落（非箇条書き）＋key-value 箇条書きの混在スライドで `convert_bullets_to_table` を掛けると、後段 `parseMd`（`md-slide-parser.ts` の table-vs-text 二択）がリード段落を**無言 drop**（never-silent 方針と不整合・undo 復旧可）。真因はツールでなく**共有パーサ**（同 drop は Markdown インポート等パーサ全経路で起こりうる）。診断が混在スライドで convert を推奨するのが引き金（`deck-diagnostics.ts:86` が bullet だけ数える）。根本策＝パーサが text+table 共存保持（共有経路・**golden 検証必須**）／安全策＝混在時は convert 非推奨 or ツールが警告返し。↑「column 内 table の認識」と同触点。
- **最背面画像のプレビュー直接ドラッグ（小）** — 最背面レイヤーはハンドルが content の下に隠れるため現状フォーム編集のみ。編集 chrome（枠線＋角ハンドル）だけを前面 overlay 化してドラッグ/リサイズを再有効化（[ADR-0020](adr/0020-image-embedding.md)）。
- **ステップ/グループセル内の Markdown 整形（要仕様判断）** — **原因特定済（2026-07-07）**：セルは `linesToParagraphs` を通り、(1) `## 見出し` は**リテラル表示**＝`linesToParagraphs` は `###`（3個）だけを heading 認識し `##`（2個）は素通り（`#`=タイトル/`##`=サブタイトル/`###`=グループ見出し という規約との齟齬）／(2) 箇条書きの `-` は `bullet:true` になるが、`SlidePreview.renderParagraph`（`para.bullet && bulletChar`）が**プレースホルダ style の `bulletChar` が空（buNone）だと記号を描かない**ため、列/セルの本文が「箇条書きなのに・が出ない」状態になる。どちらも**本文本体・round-trip に波及する仕様判断**（`##`→heading 化はシリアライザが `###` 正規化／bulletChar フォールバックはテンプレの buNone 意図と content 意図の衝突）。触点: `md-slide-parser.ts linesToParagraphs`・`SlidePreview.tsx renderParagraph`。
