# Midnight Executive — アーキテクチャ仕様書

> 本プロジェクトのシステム全体のアーキテクチャ、モジュール構成、
> データフロー、拡張方針を定義する。
>
> **関連ドキュメント**:
> - [`PROJECT_SPEC.md`](./PROJECT_SPEC.md) — プロジェクト全体仕様（テンプレート + ダイアグラム）
> - [`DIAGRAM_PIPELINE_SPEC.md`](./DIAGRAM_PIPELINE_SPEC.md) — DiagramSpec スキーマ詳細・レンダラーアルゴリズム
> - [`NAMING_CONVENTION.md`](./NAMING_CONVENTION.md) — レイアウト命名規則

---

## 1. システム全体像

本プロジェクトは2つのサブシステムで構成される。

```
┌────────────────────────────────────────────────────────────────┐
│ Subsystem A: テンプレートエンジン                                │
│                                                                │
│  create_30_layouts.py → Midnight_Executive_30_Template.pptx    │
│  （30種スライドレイアウト + デモスライド生成）                      │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│ Subsystem B: ダイアグラムパイプライン                             │
│                                                                │
│  Mermaid テキスト → [LLM変換] → DiagramSpec JSON → PPTX        │
│  （自動レイアウト図のスライド生成）                                 │
└────────────────────────────────────────────────────────────────┘
```

本仕様書は主に**Subsystem B**のアーキテクチャを定義する。

---

## 2. パイプラインアーキテクチャ（ハイブリッド方式）

### 2.1 設計思想

**基本原則**: JSON→PPTX変換（Step 3）をコアとし、Mermaid→JSON変換（Step 2）は
交換可能な外部プロセスとして扱う。

```
[Step 1]          [Step 2]              [Step 3]
Mermaid作成   →   JSON変換          →   PPTX生成
(人間 or AI)      (チャット or API)      (Python renderer)
```

### 2.2 動作モード

| モード | Step 2 の実行方法 | APIキー | ユースケース |
|--------|-------------------|---------|-------------|
| **JSON直接入力** (デフォルト) | ユーザーが用意したJSONファイルを渡す | 不要 | チャット(Claude等)でMermaid→JSON変換済みの場合 |
| **Mermaid→API自動変換** (オプション) | Python内からLLM APIを呼び出す | 必要 | 完全自動化したい場合 |
| **プロンプト出力** (ユーティリティ) | システムプロンプトをターミナルに表示 | 不要 | チャットにコピペするプロンプトを取得したい場合 |

### 2.3 判断根拠

| 判断 | 理由 |
|------|------|
| JSONを中間形式とする | Mermaidパーサーの実装コスト回避。LLMの柔軟な構文理解を活用 |
| API組み込みを必須にしない | APIキー管理の負担を強制しない。チャットベースのほうがインタラクティブに修正しやすい |
| API組み込みをオプションで残す | 将来的なバッチ処理・CI/CD統合に道を開く |
| プロンプト出力モードを提供 | ユーザーが任意のLLM（Claude, ChatGPT, Gemini等）で変換できるようにする |

---

## 3. モジュール構成

### 3.1 モジュール依存関係

```
                    ┌──────────────┐
                    │ diagram_cli  │  ← エントリポイント
                    │   .py        │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
     ┌──────────────┐ ┌──────────┐ ┌─────────────┐
     │ mermaid_     │ │ diagram_ │ │ diagram_    │
     │ prompt.py    │ │ schema.py│ │ renderer.py │
     │              │ │          │ │             │
     │ プロンプト    │ │ JSON解析 │ │ PPTX描画    │
     │ 組立・出力   │ │ バリデ   │ │ レイアウト   │
     └──────┬───────┘ └────┬─────┘ └──────┬──────┘
            │              │              │
            ▼              │         ┌────┴────┐
     ┌──────────────┐      │         ▼         ▼
     │ prompts/     │      │  ┌──────────┐ ┌──────────┐
     │  *.txt, .json│      │  │ diagram_ │ │ diagram_ │
     └──────────────┘      │  │ theme.py │ │ icons.py │
                           │  └──────────┘ └────┬─────┘
                           │                    │
                           │                    ▼
                           │             ┌──────────┐
                           │             │ icons/   │
                           │             │  *.svg   │
                           │             └──────────┘
                           │
                    (外部: python-pptx, lxml, wand)
```

### 3.2 各モジュールの責務

| モジュール | 責務 | 入力 | 出力 |
|-----------|------|------|------|
| `diagram_cli.py` | CLIエントリポイント。モード切替・引数解析 | コマンドライン引数 | PPTXファイル or プロンプトテキスト |
| `diagram_schema.py` | DiagramSpec JSON のパース・バリデーション | JSON文字列/ファイル | `DiagramSpec` dataclass |
| `diagram_renderer.py` | DiagramSpecからPPTXスライドを生成 | `DiagramSpec` + `ThemeConfig` | PPTXファイル |
| `diagram_theme.py` | テーマ定義（色・フォント・図形スタイル） | — | `ThemeConfig` dataclass |
| `diagram_icons.py` | アイコン解決・SVG→PNG変換・キャッシュ | アイコン名 or SVGパス | PNGファイルパス |
| `mermaid_prompt.py` | LLMプロンプトの組立（テンプレート+Few-shot） | Mermaidテキスト + テーマ | messages リスト or テキスト |
| `prompts/*.txt, .json` | プロンプトテンプレート・Few-shot例（データ） | — | — |

### 3.3 設計上のルール

1. **diagram_renderer.py は Mermaid を知らない**: レンダラーの入力は常にDiagramSpec。Mermaid構文には一切依存しない。
2. **mermaid_prompt.py はPPTXを知らない**: プロンプト生成はPPTXレンダリングから完全に独立。
3. **diagram_schema.py は描画を知らない**: スキーマ定義とバリデーションのみ。レイアウト計算はレンダラーの責務。
4. **diagram_cli.py が唯一の統合点**: モード選択、モジュール間の接続はCLIレイヤーで行う。

---

## 4. CLI インターフェース設計

### 4.1 基本コマンド

```bash
# Mode 1: JSON直接入力（デフォルト）
python diagram_cli.py input.json -o output.pptx

# Mode 2: Mermaid→API自動変換（オプション）
python diagram_cli.py input.mmd -o output.pptx --api-convert
#   → 環境変数 ANTHROPIC_API_KEY または OPENAI_API_KEY を使用

# Mode 3: プロンプト出力（ユーティリティ）
python diagram_cli.py --show-prompt
#   → システムプロンプト全文をstdoutに出力（チャットにコピペ用）
python diagram_cli.py --show-prompt --with-mermaid input.mmd
#   → システムプロンプト + Mermaidテキストをstdoutに出力
```

### 4.2 オプション一覧

| オプション | 短縮 | デフォルト | 説明 |
|-----------|------|-----------|------|
| `input` | — | (必須/モード依存) | 入力ファイル (.json or .mmd) |
| `--output` | `-o` | `diagram_output.pptx` | 出力PPTXファイルパス |
| `--template` | `-t` | なし | ベースとなるテンプレートPPTX（ヘッダーバー等を継承） |
| `--theme` | — | `midnight_executive` | テーマ名 |
| `--api-convert` | — | False | Mermaid入力をLLM APIで自動変換 |
| `--api-provider` | — | `anthropic` | APIプロバイダ（anthropic / openai） |
| `--show-prompt` | — | False | システムプロンプトを表示して終了 |
| `--with-mermaid` | — | なし | `--show-prompt`時にMermaidテキストも含める |
| `--validate-only` | — | False | JSONのバリデーションのみ実行（PPTX生成なし） |

### 4.3 入力ファイル自動判定

```
拡張子 .json → JSON直接入力モード
拡張子 .mmd  → --api-convert なし: エラー（「--api-convert を付けるか、先にJSONに変換してください」）
             → --api-convert あり: API自動変換モード
```

---

## 5. データフロー詳細

### 5.1 JSON直接入力モード（推奨ワークフロー）

```
┌───────────────────────────────────────────────────────┐
│  ユーザーの作業（Python外）                              │
│                                                       │
│  1. Mermaid図を作成                                    │
│  2. LLMチャットで DiagramSpec JSONに変換                │
│     (プロンプトは --show-prompt で取得可能)              │
│  3. JSONをファイルに保存                                │
└───────────────────────┬───────────────────────────────┘
                        │  input.json
                        ▼
              ┌─────────────────┐
              │  diagram_cli.py │
              │  (JSON mode)    │
              └────────┬────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
    parse_diagram  validate    render_to_pptx
    _json()        schema      ()
          │                         │
          ▼                         ▼
    DiagramSpec              output.pptx
```

### 5.2 API自動変換モード

```
input.mmd
    │
    ▼
┌─────────────────┐
│  diagram_cli.py │
│  (API mode)     │
└────────┬────────┘
         │
         ▼
┌──────────────────┐    ┌──────────────────┐
│ mermaid_prompt.py│───▶│ LLM API          │
│ build_conversion │    │ (Anthropic/OpenAI)│
│ _prompt()        │    └────────┬─────────┘
└──────────────────┘             │ JSON response
                                 ▼
                        parse_diagram_json()
                                 │
                                 ▼
                          DiagramSpec
                                 │
                                 ▼
                        render_to_pptx()
                                 │
                                 ▼
                          output.pptx
```

### 5.3 プロンプト出力モード

```
┌─────────────────┐
│  diagram_cli.py │
│  (prompt mode)  │
└────────┬────────┘
         │
         ▼
┌──────────────────┐
│ mermaid_prompt.py│
│ get_system_      │
│ prompt()         │
└────────┬─────────┘
         │
         ▼
    stdout に出力
    → ユーザーがチャットにコピペ
```

---

## 6. DiagramSpec スキーマ バージョニング

### 6.1 現行バージョン: v1.0

```json
{
  "$schema": "DiagramSpec v1.0",
  "type": "flowchart | network | orgchart",
  "direction": "TB | LR | BT | RL",
  "title": "string (optional)",
  "classDefs": { ... },
  "nodes": [ { "id", "label", "sublabel?", "shape", "class?", "style?", "group?", "icon?" } ],
  "edges": [ { "from", "to", "label?", "style?" } ],
  "groups": [ { "id", "label", "style?" } ],
  "layout": { "node_width", "node_height", "h_gap", "v_gap" }
}
```

### 6.2 拡張予定 (v1.1 候補)

| 機能 | スキーマ変更 | 優先度 |
|------|------------|--------|
| ~~ネストサブグラフ~~ | ~~`groups[].parent` フィールド追加~~ | **実装済み (step_08)** |
| ~~スイムレーン~~ | ~~`lanes[]` トップレベル追加~~ | **実装済み (step_10)** — `lanes[]` + `Node.lane` |
| ノート/注釈 | `annotations[]` トップレベル追加 | 中 |
| 条件分岐ラベル | `edges[].label_position: "start" \| "end" \| "center"` | 低 |

### 6.3 後方互換性ポリシー

- v1.x 内ではフィールド追加のみ（破壊的変更なし）
- 新フィールドはすべて Optional（既存JSONがそのまま動く）
- `$schema` のバージョン番号でパーサーの振る舞いを切替可能にする

---

## 7. テーマシステム

### 7.1 現行テーマ: Midnight Executive

```python
ThemeConfig(
    name="Midnight Executive",
    palette=Palette(
        primary="#1E2761",    # navy
        secondary="#141B41",  # dark_navy
        accent="#3B82F6",     # blue
        ...
    ),
    fonts=FontConfig(heading="Georgia", body="Calibri"),
    ...
)
```

### 7.2 テーマ拡張方針

テーマは `ThemeConfig` dataclass のファクトリメソッドとして定義する。
将来的にはYAML/JSON外部ファイルからの読み込みも検討。

```python
# 現在
theme = ThemeConfig.midnight_executive()

# 将来
theme = ThemeConfig.from_yaml("themes/corporate_light.yaml")
```

---

## 8. 外部依存関係

| パッケージ | バージョン | 用途 | 必須/オプション |
|-----------|-----------|------|---------------|
| `python-pptx` | ≥0.6.21 | PPTX生成・操作 | 必須 |
| `lxml` | ≥4.9 | OOXML直接操作 | 必須（python-pptx依存） |
| `wand` | ≥0.6 | SVG→PNG変換（ImageMagick binding） | アイコン使用時のみ |
| `anthropic` | ≥0.18 | Anthropic API呼び出し | `--api-convert --api-provider anthropic` 時のみ |
| `openai` | ≥1.0 | OpenAI API呼び出し | `--api-convert --api-provider openai` 時のみ |

**原則**: コアパイプライン（JSON→PPTX）は `python-pptx` + `lxml` のみで動作する。
LLM APIクライアントはオプション依存として、import時にチェックする。

---

## 9. ディレクトリ構成

```
presentations/
├── ARCHITECTURE.md              ← 本ドキュメント
├── PROJECT_SPEC.md              ← プロジェクト全体仕様
├── DIAGRAM_PIPELINE_SPEC.md     ← DiagramSpec スキーマ・アルゴリズム詳細
├── NAMING_CONVENTION.md         ← レイアウト命名規則
├── Midnight_Executive_30_Template.pptx
│
├── src/
│   ├── diagram_cli.py           ← CLIエントリポイント
│   ├── diagram_renderer.py      ← JSON→PPTX レンダラー
│   ├── diagram_schema.py        ← DiagramSpec パーサー・バリデーション
│   ├── diagram_theme.py         ← テーマ定義
│   ├── diagram_icons.py         ← アイコン管理（SVG→PNG変換）
│   ├── mermaid_prompt.py        ← プロンプト組立ユーティリティ
│   ├── create_30_layouts.py     ← テンプレート生成（Subsystem A）
│   ├── poc_editable_diagram.py  ← PoC参照実装
│   ├── rename_placeholders.py   ← ユーティリティ
│   │
│   ├── icons/                   ← ビルトインSVGアイコン（15種）
│   │   ├── router.svg
│   │   ├── switch.svg
│   │   └── ...
│   │
│   └── prompts/                 ← LLMプロンプト（データファイル）
│       ├── mermaid_system_prompt.txt
│       └── mermaid_examples.json
│
├── steps/                       ← ステップ記録
│   ├── step_05_complex_diagram_support.md
│   ├── step_06_network_icons.md
│   └── step_07_architecture_design.md  ← 本ステップ
│
└── test_pptx/                   ← テスト出力
    ├── DiagramComplexity_*.pptx
    ├── DiagramIcons_Test.pptx
    └── ...
```

---

## 10. 今後のロードマップ

| 優先度 | 機能 | 影響範囲 | 備考 |
|--------|------|---------|------|
| ~~**高**~~ | ~~`diagram_cli.py` 実装~~ | ~~新規ファイル~~ | **実装済み (step_09)** — 3モード対応 |
| ~~**高**~~ | ~~ネストサブグラフ対応~~ | ~~schema + renderer~~ | **実装済み (step_08)** — Group.parent, 最大3階層 |
| ~~**高**~~ | ~~スイムレーン対応~~ | ~~schema + renderer~~ | **実装済み (step_10)** — `lanes[]` + v3レイアウト |
| ~~**中**~~ | ~~JSON診断レイヤー~~ | ~~schema~~ | **実装済み (step_11)** — `diagnose_json()` 必須フィールド検証・未知フィールド検出・類似名サジェスト |
| ~~**中**~~ | ~~テーマ外部ファイル化~~ | ~~theme + cli~~ | **実装済み (step_12)** — YAML部分マージ + `--theme` CLI引数 |
| ~~低~~ | ~~edge label 衝突回避~~ | ~~renderer~~ | **実装済み (step_08)** — `_place_edge_label()` |
| ~~**中**~~ | ~~コネクタルーティング改善~~ | ~~renderer~~ | **実装済み (step_13)** — グループ関係ベース分類・Manhattan routing・バスライン・dash反映 |
| 低 | 複数スライド分割 | renderer + cli | 大規模図の対応 |

---

*作成: 2026-03-27 | 更新: 2026-03-28 | バージョン: 1.0*
