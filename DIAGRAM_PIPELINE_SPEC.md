# Midnight Executive — Mermaid→PPTX ダイアグラム変換パイプライン仕様

> 本ドキュメントは DiagramSpec スキーマ定義とレンダラーアルゴリズムの詳細仕様です。
> システム全体のアーキテクチャは [`ARCHITECTURE.md`](./ARCHITECTURE.md) を参照してください。

---

## 1. アーキテクチャ概要

```
Mermaid テキスト
    │
    ▼
[LLM Prompt] ── Mermaid構文を解釈し、中間JSONを生成
    │
    ▼
Intermediate JSON (DiagramSpec)
    │
    ▼
[diagram_renderer.py] ── JSONを読み取り、自動レイアウト＋python-pptxで描画
    │
    ▼
PPTX ファイル（編集可能なベクター図形）
```

**設計判断**: Mermaidを直接パースせず、LLMに中間JSON変換を委ねる方式を採用。
- **理由**: Mermaid構文のカバレッジが大きく（flowchart, graph, class, sequence...）、パーサー実装コストが高い。LLMなら構文のバリエーションを吸収でき、自然言語入力にも対応可能。
- **トレードオフ**: LLM出力の非決定性。→ JSONスキーマを厳密に定義し、バリデーションで担保。

---

## 2. 中間スキーマ (DiagramSpec) 定義

```json
{
  "$schema": "DiagramSpec v1.0",
  "type": "flowchart | network | orgchart",
  "direction": "TB | LR | BT | RL",
  "title": "図のタイトル（オプション）",

  "classDefs": {
    "クラス名": {
      "fill": "#hex",
      "border": "#hex",
      "border_width": 1.5,
      "border_dash": false,
      "font_color": "#FFFFFF",
      "font_size": 11,
      "font_bold": true
    }
  },

  "nodes": [
    {
      "id": "一意識別子",
      "label": "表示テキスト",
      "sublabel": "副テキスト（オプション、orgchartの役職名等）",
      "shape": "rect | rounded_rect | diamond | circle | oval | hexagon",
      "class": "classDefs内のクラス名（オプション）",
      "style": { "…classDefsと同じキー、個別オーバーライド用…" },
      "group": "グループID（オプション）"
    }
  ],

  "edges": [
    {
      "from": "ノードID",
      "to": "ノードID",
      "label": "ラベル（オプション）",
      "style": {
        "color": "#hex",
        "width": 2,
        "arrow": true,
        "dash": false
      }
    }
  ],

  "groups": [
    {
      "id": "グループID",
      "label": "表示名",
      "style": {
        "border": "#hex",
        "border_dash": true,
        "fill": null
      }
    }
  ],

  "layout": {
    "node_width": 2.0,
    "node_height": 0.7,
    "h_gap": 0.5,
    "v_gap": 0.8
  }
}
```

### スキーマ設計の判断根拠

| 要素 | 決定 | 理由 |
|------|------|------|
| `classDefs` | Mermaid互換のクラスシステム | ノード毎のstyle指定は冗長。クラスで一括管理し、個別overrideのみ`style`で指定 |
| `shape` | 6種に限定 | python-pptxのMSO_SHAPE対応。PoC検証済みの形状のみ採用 |
| `direction` | TB/LR/BT/RL | Mermaidのgraph方向と1:1対応 |
| `groups` | ノード側で`group`参照 | ネットワーク図のゾーン表示（DMZ, Core等）に対応 |
| `sublabel` | orgchart専用 | 組織図の「役職＋氏名」2行表示に対応 |
| `layout` | サイズ・間隔のみ | 座標計算はレンダラー側の自動レイアウトに委ねる |

### shape → MSO_SHAPE マッピング

| DiagramSpec | MSO_SHAPE | 用途 |
|-------------|-----------|------|
| `rect` | `RECTANGLE` | プロセス、サーバー |
| `rounded_rect` | `ROUNDED_RECTANGLE` | 開始/終了、ルーター |
| `diamond` | `DIAMOND` | 判断分岐 |
| `circle` | `OVAL` | イベント、ノード |
| `oval` | `OVAL` | 楕円（横長） |
| `hexagon` | `HEXAGON` | 準備、並列処理 |

---

## 3. レンダラーの自動レイアウトアルゴリズム

**Step 1: トポロジカルソートによるレイヤー割り当て**
- edgesのDAGから各ノードのレイヤー（深さ）を計算
- サイクルがある場合はback-edgeを検出して除外

**Step 2: レイヤー内のノード配列**
- 同一レイヤーのノードを水平（TB/BT時）または垂直（LR/RL時）に均等配置
- groupに属するノードは隣接配置

**Step 3: 座標計算**
- `layout.node_width/height` と `layout.h_gap/v_gap` からピクセル座標を算出
- スライド幅13.333"に対してセンタリング

**Step 4: グループ矩形の描画**
- 同一groupに属するノードのバウンディングボックス + パディングで矩形生成

**Step 5: コネクタ描画**
- PoC検証済みのヘルパー関数群を使用
- diamond→他ノードは`snap=False`（PoC検証済みのバグ回避）
- flowchartタイプでは全コネクタに矢印付与
- L字型マージパスは自動検出（同一ノードに複数の入力エッジがある場合）
- **サイクル（バックエッジ）**: DFSで検出し、U字型ルーティング（右マージン迂回、破線描画）
- **方向認識CP検出**: `_detect_cp()` がlayer情報を利用し、TB inter-layerでは常にbottom→top接続

---

## 4. Mermaid→JSON 変換プロンプト設計方針

- System Promptで DiagramSpec v1.0 スキーマ全文を提示
- Few-shot例として3パターン（flowchart, network, orgchart）のMermaid→JSON変換例を含める
- Mermaidのsubgraphは`groups`にマッピング
- Mermaidの`classDef`は`classDefs`にそのまま対応
- 出力はJSONのみ（説明文なし）を指示

---

## 5. ファイル構成

| ファイル | 場所 | 状態 | 説明 |
|---------|------|------|------|
| `diagram_schema.py` | `src/` | ✅ 完成 | DiagramSpec v1.0 dataclass + JSONパーサー + バリデーション + icon対応 |
| `diagram_renderer.py` | `src/` | ✅ 完成 | JSON → PPTX レンダラー（ThemeConfig統合, サイクル検出, バックエッジU字ルーティング, アイコン描画） |
| `diagram_theme.py` | `src/` | ✅ 完成 | テーマ設定（Palette, FontConfig, NodeDefaults, DiagramStyle） |
| `diagram_icons.py` | `src/` | ✅ 完成 | アイコンマネージャー（SVG→PNG変換, キャッシュ, ビルトイン/カスタム対応） |
| `icons/*.svg` | `src/icons/` | ✅ 完成 | ビルトインSVGアイコン15種（Ciscoスタイル線画） |
| `mermaid_prompt.py` | `src/` | ✅ 完成 | プロンプトローダー（外部ファイルからテンプレート/例を読み込み） |
| `prompts/mermaid_system_prompt.txt` | `src/prompts/` | ✅ 完成 | システムプロンプトテンプレート（{palette_section}等のプレースホルダー） |
| `prompts/mermaid_examples.json` | `src/prompts/` | ✅ 完成 | Few-shot例3パターン（flowchart, network, orgchart） |
| `poc_editable_diagram.py` | `src/` | ✅ 完成 | PoC（ネットワーク/フロー/組織図の参照実装） |

---

## 6. 実装済み機能

- **DiagramSpec v1.0 スキーマ**: 6種のshape, classDef継承, groups, edge label, iconフィールド対応
- **ネットワークアイコン**: 15種のビルトインSVGアイコン（Ciscoスタイル線画）+ SVG→PNG自動変換 + キャッシュ
- **自動レイアウトエンジン**: トポロジカルソート → レイヤー配置 → 自動スケーリング
- **サイクル検出**: DFSバックエッジ検出 → DAGのみでレイヤー割当（サイクルがあっても正常動作）
- **描画ヘルパー**: ダイアモンドcp回避(snap=False), 矢印(OOXML tailEnd), L字マージパス, ゾーン矩形
- **バックエッジルーティング**: サイクル辺を右マージン迂回のU字型破線で描画
- **方向認識コネクタ**: `_detect_cp()`がlayer/direction情報を使用し、TB inter-layerでbottom→top接続を保証
- **ThemeConfig統合**: Midnight Executiveテーマ（Georgia/Calibri, ネイビーパレット, ヘッダーバー）
- **プロンプト/コード分離**: テンプレート(.txt) + Few-shot(.json) + ローダー(.py) の3ファイル構成
- **Mermaid変換プロンプト**: system prompt + 3パターンfew-shot (flowchart/network/orgchart)
- **E2Eパイプライン検証済み**: Mermaid → LLM Agent → JSON → バリデーション → PPTX

---

## 7. 既知の制限事項と改善候補

| # | 制限事項 | 影響 | 改善案 |
|---|---------|------|--------|
| 1 | 深い線形フロー（10層以上）で自動スケーリングが強く効きノードが小さくなる | 可読性低下 | レイヤー数に応じてv_gapを動的調整、またはスクロール可能な複数スライド分割 |
| 2 | LLM出力がスキーマと微妙にずれることがある（top-level構造、edge.arrow位置等） | 手動正規化が必要 | 正規化レイヤーの実装（fuzzy schema matching） |
| 3 | ダイアモンドからの水平コネクタはsnap=Falseのため、PowerPointで形状移動時に追従しない | 編集時の手間 | OOXML直接操作でcxnSpのxfrm座標を正確に設定する方式の検討 |
| 4 | ~~edge labelの位置がコネクタ中間点固定で、密集時に重なる可能性~~ | **対応済み (step_08)** | `_place_edge_label()`: 優先候補リスト + ノードBBox衝突判定 + スライド境界制約 + ワイドオフセット |
| 5 | ~~subgraphのネスト未対応~~ | **対応済み (step_08)** | `_compute_layout_v2()`: Group.parentによる最大3階層ネスト、bottom-up size → top-down allocation |

---

*最終更新: 2026-03-27*
