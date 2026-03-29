# Midnight Executive Template — プロジェクト仕様書

> このドキュメントは、コンテキストウィンドウのリセットに備え、
> 要件・設計判断・試行錯誤の経緯・現在の状態をすべて記録するものです。
> 新しいセッションでは、まずこのドキュメントと `create_30_layouts.py` を読んでから作業を再開してください。
>
> **関連ドキュメント**:
> - [`ARCHITECTURE.md`](./ARCHITECTURE.md) — システムアーキテクチャ仕様書（パイプライン設計・モジュール構成）
> - [`NAMING_CONVENTION.md`](./NAMING_CONVENTION.md) — 命名規則・全30レイアウトのPlaceholder一覧
> - [`DIAGRAM_PIPELINE_SPEC.md`](./DIAGRAM_PIPELINE_SPEC.md) — Mermaid→PPTX ダイアグラム変換パイプライン仕様
> - [`HOW_TO_USE.md`](./HOW_TO_USE.md) — ダイアグラムパイプライン利用ガイド（日英併記）

---

## 1. プロジェクト概要

PowerPoint (.pptx) のスライドマスターテンプレートを、python-pptx + lxml で OOXML レベルから生成するプロジェクト。

**目的**: プロフェッショナルなデータ分析/レポート向けスライドを量産しやすくするための、再利用性の高いテンプレートの構築。

**成果物**: `Midnight_Executive_30_Template.pptx`（30種類のスライドレイアウト + 全レイアウトのデモスライド30枚）

---

## 2. 設計要件

### 2.1 ユーザー要件

- **レイアウトパターン数**: 20〜30種類（「AIが作ったテンプレート」感を避けるため、少数パターンの繰り返しではなく多様性を持たせる）
- **プレースホルダーは文字のみ**: 装飾・背景・パネル等のビジュアル要素はすべてスライドレイアウトに焼き込み、ユーザーはテキストを入れるだけで完成する
- **デザインテーマ**: "Midnight Executive"（ダーク系の落ち着いたプロフェッショナルトーン）
- **レイアウト用途**: データ/分析レポート型
- **デモスライドはマスター忠実**: デモスライドでフォントサイズ・色・太字等を一切オーバーライドせず、スライドマスターのスタイルのみで表示する（ユーザーはPowerPointライセンスがないため、デモスライドでしか品質を確認できない）

### 2.2 デザイン原則

- サンドイッチ構造（ダーク → ライト → ダーク）: タイトル・セクション・クロージングはダーク背景、コンテンツスライドはライト背景
- タイトル下のアクセントライン禁止（AI生成物の特徴として避ける）
- ビジュアルモチーフ: 左端の太いアクセントバー + 幾何学パネル
- 角丸パネル、カードUI風のレイアウトを活用

### 2.3 ユーザーの閲覧環境

- PowerPointライセンスなし（同PC上）
- 主な確認手段: Cowork GUI のプレビュー、Google Slides
- Google Slides はカスタムレイアウト・OPC追加レイアウト・lstStyle の bullet suppression 等のOOXML独自機能に対して互換性が低い（確認済み）

---

## 3. カラーパレット

```python
C = {
    'navy':        '1E2761',   # メイン背景色（ダークスライド）
    'dark_navy':   '141B41',   # より暗い背景・パネル
    'ice_blue':    'CADCFC',   # ダーク背景上のサブテキスト
    'white':       'FFFFFF',   # ライト背景・ダーク背景上のメインテキスト
    'light_gray':  'F5F7FA',   # ライト背景色
    'panel_gray':  'EDF0F7',   # パネル・カード背景
    'mid_gray':    '94A3B8',   # 出典・スライド番号等の補助テキスト
    'dark_text':   '1E293B',   # ライト背景上の本文テキスト
    'accent':      '3B82F6',   # アクセントカラー（青）
    'accent_dark': '2563EB',   # アクセントバリエーション
    'teal':        '06B6D4',   # セカンダリアクセント（ティール）
    'amber':       'F59E0B',   # サードアクセント（アンバー）
    'soft_navy':   '2D3A6E',   # パネル用の柔らかいネイビー
    'card_bg':     'F0F4FF',   # カード・コールアウト背景
}
```

**フォント**: 見出し = Georgia, 本文 = Calibri

---

## 4. 試行錯誤の記録（重要な設計判断）

### 4.1 プレースホルダーidx の衝突問題

**問題**: `type='body'` + `idx=0` の組み合わせで、コンテンツスライドのタイトルが非表示になった。
**原因**: idx=0 は OOXML 仕様で `title` / `ctrTitle` 専用の予約インデックス。
**解決**: コンテンツスライドのタイトルには `type='body'` + `idx=15` を使用。カスタムプレースホルダーは idx=15 以上を使う規約とした。

**現在のidx割り当て規約**:
- `idx=0`: ctrTitle（タイトルスライド用）
- `idx=1`: subTitle / body（メインコンテンツ）
- `idx=2〜9`: 追加コンテンツ（カラム、データ等）
- `idx=10〜14`: ラベル、メタ情報、フッター等
- `idx=15`: スライドタイトル（_header_bar で使用）
- `idx=16`: サブタイトル（_header_bar で使用）
- `idx=50`: スライド番号

### 4.2 OPC によるレイアウト追加（12枚目以降）

**問題**: python-pptx のデフォルト Presentation には 11 スロットしかスライドレイアウトがない。
**解決**: 12枚目以降は OPC（Open Packaging Convention）レイヤーで直接追加。

```python
# 重要: parse_xml() を使うことで CT_SlideLayout 型が正しく生成される
elem = parse_xml(xml_bytes)  # etree.fromstring() ではダメ
new_part = SlideLayoutPart(partname, ct, prs.part.package, elem)
# 引数順序: (partname, content_type, package, element) — package と element の順序に注意
```

**失敗した試み**:
1. `pptx.opc.part` からの import → 存在しない。`pptx.opc.package` が正しい
2. `SlideLayoutPart(partname, ct, element, package)` → 引数順序が逆。package が先
3. `etree.fromstring()` で生成した要素 → `.cSld` プロパティがなくエラー。`parse_xml()` が必要

### 4.3 フォント色の継承問題（最重要）

**問題**: `ph.text = "..."` でテキストを設定すると、フォント色が消えてデフォルトの黒になる。ダーク背景で文字が見えなくなる。
**原因**: `ph.text` は既存の `<a:r>`（rPr含む）を全削除して新しいプレーンな `<a:r>` を作る。プロンプトテキストの `<a:rPr>` に設定していた `solidFill` が消滅する。
**解決**: `lstStyle` 内の `defPPr` と全9レベルの `lvlNpPr` に `defRPr` を追加。`defRPr` にフォント色・サイズ・フォント名・太字を定義する。段落レベルのデフォルトスタイルなので、Run に明示指定がなくても継承される。

```xml
<!-- lstStyle 内の構造 -->
<a:defPPr algn="l">
  <a:buNone/>
  <a:defRPr sz="2800" b="1">
    <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
    <a:latin typeface="Georgia"/>
    <a:ea typeface="Georgia"/>
  </a:defRPr>
</a:defPPr>
```

### 4.4 Bullet 抑制

**問題**: body タイプのプレースホルダーがデフォルトでブレットポイントを継承する。
**解決**: lstStyle の `defPPr` + 全9レベル `lvlNpPr` + 個別段落の `pPr` すべてに `<a:buNone/>` を設定。

### 4.5 テキストコントラスト

**問題**: ダーク背景で `mid_gray`（#94A3B8）のテキストはコントラスト不足。
**解決**: ダーク背景上のサブテキストには `ice_blue`（#CADCFC）を使用。対象: タイトル日付、レポート表紙フッター、スプリットタイトル日付、セクションの SECTION ラベル、クロージング連絡先情報。

### 4.6 カラーパレットの調整

**経緯**: ユーザーが「色が濃すぎ」と指摘 → navy を #3B4F8A（ライトネイビー）に変更 → ユーザーが「微妙だな。戻して」→ #1E2761 に復帰。
**結論**: 背景色は変えず、文字色の白黒使い分けで対応するのが正解。

### 4.7 比較マトリクスのテーブル化

**問題**: プレースホルダーで表形式を再現しようとすると、カラムヘッダー（navy矩形）とテキストが重なって崩れる。
**解決**: レイアウトはシンプルな内容エリアのみとし、デモスライドには python-pptx の `Table` API で実テーブルを配置。ヘッダー行は navy 背景 + 白文字、データ行は白/panel_gray の交互ストライプ。

### 4.8 デモスライドのスタイルオーバーライド問題

**問題**: 初期の `set_ph()` が font_size, font_name, color, bold パラメータを受け取ってスタイルを上書きしていた。これではデモスライドがスライドマスターの本来の見た目を反映しない。
**解決**: `set_ph()` をテキストのみ受け取る関数に書き換え、全30デモスライドを再生成。

```python
def set_ph(slide, idx, text):
    """Set TEXT ONLY on a placeholder. No style overrides."""
    for ph in slide.placeholders:
        if ph.placeholder_format.idx == idx:
            ph.text = text
            return ph
    return None
```

### 4.9 LibreOffice PDF 変換

**状況**: `soffice` コマンドによる PDF 変換がこのセッションでは動作せず。
**回避策**: プレビューは Cowork GUI と PowerPoint/Google Slides で直接確認。

---

## 5. 30 レイアウト一覧

| # | 関数名 | 日本語名 | 背景 | 用途 |
|---|--------|----------|------|------|
| 0 | L00_title_standard | タイトル：標準 | navy | 全面ダーク、左アクセントバー |
| 1 | L01_title_report | タイトル：レポート表紙 | navy | 右にメタデータパネル |
| 2 | L02_title_split | タイトル：スプリット | navy+light_gray | 左ダーク右ライトの分割 |
| 3 | L03_section_standard | セクション：標準 | dark_navy | ラベル+大タイトル+説明 |
| 4 | L04_section_numbered | セクション：ナンバー付 | dark_navy | 大きな番号+タイトル横並び |
| 5 | L05_section_banner | セクション：バナー | dark_navy | 中央にnavyバナー帯 |
| 6 | L06_content_standard | コンテンツ：標準 | ヘッダーbar+白 | 全幅ボディエリア |
| 7 | L07_content_sidebar | コンテンツ：サイドバー付 | ヘッダーbar+白 | 右にパネル灰サイドバー |
| 8 | L08_content_source | コンテンツ：出典バー付 | ヘッダーbar+白 | 下に出典フッター |
| 9 | L09_content_callout | コンテンツ：コールアウト付 | ヘッダーbar+白 | 上にアクセント付きコールアウト |
| 10 | L10_two_col | 2カラム：均等 | ヘッダーbar+白 | 左右50/50 |
| 11 | L11_two_col_wide | 2カラム：ワイド左 | ヘッダーbar+白 | 左65%+右パネル35% |
| 12 | L12_three_col | 3カラム | ヘッダーbar+白 | 3等分 |
| 13 | L13_kpi_single | KPI：シングル | ヘッダーbar+白 | 大型KPI値1つ |
| 14 | L14_kpi_two | KPI：2カード | ヘッダーbar+白 | 2枚のKPIカード |
| 15 | L15_kpi_three | KPI：3カード | ヘッダーbar+白 | 3枚のKPIカード |
| 16 | L16_kpi_grid | KPI：4グリッド | ヘッダーbar+白 | 2×2グリッド |
| 17 | L17_chart_full | チャート：フル幅 | ヘッダーbar+白 | 全幅チャートエリア |
| 18 | L18_chart_text | チャート＋テキスト | ヘッダーbar+白 | 左チャート+右テキスト |
| 19 | L19_chart_dual | チャート：2面 | ヘッダーbar+白 | 2つのチャート横並び |
| 20 | L20_table_full | テーブル：フル幅 | ヘッダーbar+白 | 全幅テーブル+出典 |
| 21 | L21_table_notes | テーブル＋ノート | ヘッダーbar+白 | テーブル+右ノートパネル |
| 22 | L22_comparison_side | 比較：サイドバイサイド | ヘッダーbar+白 | 2パネル+VS円 |
| 23 | L23_comparison_matrix | 比較：マトリクス | ヘッダーbar+白 | シンプルエリア（デモでTable使用） |
| 24 | L24_timeline_horizontal | タイムライン：横 | ヘッダーbar+白 | 4ステップ横プロセス |
| 25 | L25_process_vertical | プロセス：縦 | ヘッダーbar+白 | 3ステップ縦プロセス |
| 26 | L26_agenda | アジェンダ | 左navy+右白 | 左パネルにタイトル、右にアイテム |
| 27 | L27_executive_summary | エグゼクティブサマリー | ヘッダーbar+白 | 発見事項+推奨パネル |
| 28 | L28_closing_thankyou | クロージング：感謝 | navy | Thank you + 連絡先 |
| 29 | L29_closing_nextsteps | クロージング：ネクストステップ | navy | ステップ+CTAパネル |

> **命名規則・Placeholder詳細**: → [`NAMING_CONVENTION.md`](./NAMING_CONVENTION.md)

---

## 6. コード構造（create_30_layouts.py — 1346行）

```
[1-26]     imports
[28-63]    定数: SLIDE_W/H, カラーパレット C, フォント, XML名前空間
[65-69]    _tag(): XML名前空間ヘルパー
[76-148]   XML要素ビルダー: El(), Sub(), xml_rect(), xml_roundrect(), xml_circle()
[153-214]  xml_ph(): プレースホルダービルダー（lstStyle + defRPr でスタイル継承対応済み）
[221-238]  _build_layout(): レイアウトXML組み立て
[242-257]  _header_bar(), _slide_num(): 共通部品
[260-900]  30個のレイアウト定義関数 L00〜L29
[906-937]  ALL_LAYOUTS: レイアウト関数の登録リスト
[944-983]  inject_layouts(): レイアウト注入（前半11上書き + 後半OPC追加）
[990-996]  set_ph(): テキストのみ設定（スタイルオーバーライドなし）
[999-1087] add_matrix_table(), _set_cell_borders(): テーブルヘルパー
[1093-1345] メイン: テンプレート生成 + 全30デモスライド作成 + 保存
```

---

## 7. 主要なヘルパー関数

### `xml_ph()` — プレースホルダー生成

```python
xml_ph(sid, name, ph_type, ph_idx, x, y, w, h,
       font_size=14, font_name=F_BODY, font_color='1E293B',
       bold=False, align='l', prompt='テキストを入力')
```

- `lstStyle > defPPr/lvlNpPr > defRPr` にフォント色・サイズ・フォント名・太字を設定
- `<a:buNone/>` で全レベルの bullet を抑制
- プロンプトテキスト（ゴーストテキスト）も同じスタイルで設定

### `_header_bar()` — コンテンツスライド共通ヘッダー

- navy背景のヘッダーバー（高さ 1.15インチ）
- タイトル (idx=15, Georgia 28pt 白 太字)
- サブタイトル (idx=16, Calibri 12pt ice_blue)

### `inject_layouts()` — レイアウト注入

- `i < 11`: 既存スロットの XML 要素を上書き
- `i >= 11`: OPC で SlideLayoutPart を新規追加し、sldLayoutIdLst に登録

### `set_ph()` — デモスライドへのテキスト設定

- テキストのみ設定、スタイルは一切触らない
- `ph.text = text` で完結（フォント色等は lstStyle の defRPr から継承）

### `add_matrix_table()` — 比較マトリクス用テーブル

- python-pptx の Table API で実テーブルを配置
- ヘッダー行: navy + 白文字, データ行: 白/panel_gray 交互

---

## 8. 既知の制約・注意事項

1. **Google Slides 互換性**: カスタムレイアウト、OPC追加レイアウト（12枚目以降）、lstStyle の bullet 抑制は Google Slides では正しく表示されない可能性がある
2. **LibreOffice**: このセッションでは soffice コマンドが動作しなかった（PDF変換不可）
3. **テーブルはレイアウトに埋め込めない**: OOXML の仕様上、テーブルはスライドレイアウトのプレースホルダーとして定義できない。テーブルが必要なスライドはデモスライド上で直接テーブルを配置する
4. **type='title' のアライメント**: `type='title'` プレースホルダーはスライドマスターの `<p:titleStyle>` からセンター揃えを継承する。左揃えにしたい場合は `type='body'` + ユニークな idx を使う

---

## 9. 今後の改善候補

- [ ] 各レイアウトの細かなデザイン調整（余白、フォントサイズバランス等）
- [ ] テーブルレイアウト（L20, L21）にもデモスライドで実テーブルを追加
- [ ] チャートレイアウト（L17〜L19）にダミーチャート画像を追加
- [ ] 追加デザインテーマの開発
- [ ] テンプレートを使ったスライド自動生成パイプラインの構築
- [ ] PowerPoint 実機での最終品質確認

> **ダイアグラム変換パイプラインの制限事項・改善候補**: → [`DIAGRAM_PIPELINE_SPEC.md`](./DIAGRAM_PIPELINE_SPEC.md) §7

---

## 10. ファイル一覧

### テンプレート関連

| ファイル | 場所 | 説明 |
|---------|------|------|
| `create_30_layouts.py` | `/sessions/stoic-zealous-fermi/` | テンプレート生成スクリプト（メインコード） |
| `Midnight_Executive_30_Template.pptx` | `mnt/presentations/` | 生成されたテンプレートファイル |

### ダイアグラム変換パイプライン

| ファイル | 場所 | 説明 |
|---------|------|------|
| `poc_editable_diagram.py` | `src/` | PoC: 編集可能ベクター図形（参照実装） |
| `PoC_Editable_Diagrams.pptx` | `mnt/presentations/` | PoC出力（ネットワーク/フロー/組織図） |
| `diagram_schema.py` | `src/` | DiagramSpec v1.0 バリデーション |
| `diagram_renderer.py` | `src/` | JSON→PPTX レンダラー（ThemeConfig統合, サイクル検出, バックエッジルーティング） |
| `diagram_theme.py` | `src/` | テーマ設定（Palette, FontConfig, DiagramStyle） |
| `diagram_icons.py` | `src/` | アイコンマネージャー（SVG→PNG変換, キャッシュ） |
| `icons/*.svg` | `src/icons/` | ビルトインSVGアイコン15種（Ciscoスタイル） |
| `mermaid_prompt.py` | `src/` | Mermaid→JSON 変換プロンプトローダー |
| `prompts/mermaid_system_prompt.txt` | `src/prompts/` | システムプロンプトテンプレート |
| `prompts/mermaid_examples.json` | `src/prompts/` | Few-shot例（3パターン） |

### ドキュメント

| ファイル | 場所 | 説明 |
|---------|------|------|
| `PROJECT_SPEC.md` | `mnt/presentations/` | 本ドキュメント（プロジェクト全体仕様） |
| `ARCHITECTURE.md` | `mnt/presentations/` | システムアーキテクチャ仕様書 |
| `NAMING_CONVENTION.md` | `mnt/presentations/` | 命名規則・Placeholder一覧 |
| `DIAGRAM_PIPELINE_SPEC.md` | `mnt/presentations/` | Mermaid→PPTX パイプライン仕様 |
| `HOW_TO_USE.md` | `mnt/presentations/` | ダイアグラムパイプライン利用ガイド（日英併記） |

### ステップ記録

| ファイル | 場所 | 説明 |
|---------|------|------|
| `step_05_complex_diagram_support.md` | `steps/` | 複雑図サポート（サイクル検出・バックエッジルーティング） |
| `step_06_network_icons.md` | `steps/` | ネットワーク機器アイコン対応（15種SVG + レンダラー統合） |
| `step_07_architecture_design.md` | `steps/` | アーキテクチャ設計（ハイブリッドパイプライン） |
| `step_08_nested_subgraph.md` | `steps/` | ネストサブグラフ対応（スキーマ拡張 + v2レイアウトアルゴリズム） |
| `step_09_cli_and_label_fix.md` | `steps/` | CLI実装 + エッジラベル衝突回避アルゴリズム |
| `step_10_swimlane.md` | `steps/` | スイムレーン対応（Lane スキーマ + v3レイアウト + LR L字ルート） |
| `step_11_json_diagnostics.md` | `steps/` | JSON診断レイヤー（必須フィールド検証・未知フィールド検出・類似名サジェスト） |
| `step_12_theme_externalization.md` | `steps/` | テーマ外部ファイル化（YAML + 部分マージ + CLI --theme） |
| `step_13_connector_routing.md` | `steps/` | コネクタルーティング改善（グループ関係ベース分類・Manhattan routing・バスライン） |

---

*最終更新: 2026-03-28*
