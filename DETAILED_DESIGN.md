# Diagram Pipeline 詳細設計書

> Midnight Executive — Mermaid→JSON→PPTX ダイアグラム変換パイプライン
>
> Version 1.0 | 2026-03-29

---

## 1. システム概要

### 1.1 目的

Mermaid記法またはJSON中間表現（DiagramSpec）から、編集可能なPowerPointベクター図形を自動生成するパイプライン。flowchart、network、orgchart の3種類の図タイプをサポートし、自動レイアウトとテーマ適用を行う。

### 1.2 設計思想

JSON→PPTX変換（Step 3）をコアとし、Mermaid→JSON変換（Step 2）は交換可能な外部プロセスとして扱う。Mermaid構文を直接パースせず、LLMに中間JSON変換を委ねる方式を採用した。これにより、Mermaid構文のバリエーションをLLMが吸収し、自然言語入力にも対応可能となる。

**トレードオフ**: LLM出力の非決定性 → JSONスキーマを厳密に定義し、バリデーション＋診断レイヤーで担保。

### 1.3 動作モード

| モード | Step 2 の実行方法 | APIキー | ユースケース |
|--------|-------------------|---------|-------------|
| **JSON直接入力**（デフォルト） | ユーザーが用意したJSONファイルを渡す | 不要 | チャットでMermaid→JSON変換済みの場合 |
| **Mermaid→API自動変換** | Python内からLLM APIを呼び出す | 必要 | 完全自動化したい場合 |
| **プロンプト出力** | システムプロンプトをターミナルに表示 | 不要 | チャットにコピペするプロンプトを取得 |

---

## 2. アーキテクチャ設計

### 2.1 パイプラインフロー

```
Mermaidテキスト → LLM Prompt → DiagramSpec JSON → diagram_renderer.py → PPTXファイル
```

レンダラーはMermaid構文を知らず、入力は常にDiagramSpecである。

### 2.2 モジュール依存関係

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
     └──────────────┘ └──────────┘ └──────┬──────┘
                                     ┌────┴────┐
                                     ▼         ▼
                              ┌──────────┐ ┌──────────┐
                              │ diagram_ │ │ diagram_ │
                              │ theme.py │ │ icons.py │
                              └──────────┘ └──────────┘
```

| モジュール | 責務 | 入力 | 出力 |
|-----------|------|------|------|
| `diagram_cli.py` | CLIエントリポイント。モード切替・引数解析 | コマンドライン引数 | PPTX or プロンプトテキスト |
| `diagram_schema.py` | DiagramSpec JSONのパース・バリデーション | JSON文字列 | `DiagramSpec` dataclass |
| `diagram_renderer.py` | DiagramSpecからPPTXスライドを生成 | `DiagramSpec` + `ThemeConfig` | PPTXファイル |
| `diagram_theme.py` | テーマ定義（色・フォント・図形スタイル） | YAMLファイル or デフォルト | `ThemeConfig` dataclass |
| `diagram_icons.py` | アイコン解決・SVG→PNG変換・キャッシュ | アイコン名 or SVGパス | PNGファイルパス |
| `mermaid_prompt.py` | LLMプロンプトの組立 | Mermaidテキスト + テーマ | messagesリスト or テキスト |

### 2.3 設計上のルール

1. **diagram_renderer.py は Mermaid を知らない**: レンダラーの入力は常にDiagramSpec。Mermaid構文には一切依存しない。
2. **mermaid_prompt.py はPPTXを知らない**: プロンプト生成はPPTXレンダリングから完全に独立。
3. **diagram_schema.py は描画を知らない**: スキーマ定義とバリデーションのみ。レイアウト計算はレンダラーの責務。
4. **diagram_cli.py が唯一の統合点**: モード選択、モジュール間の接続はCLIレイヤーで行う。

### 2.4 外部依存関係

| パッケージ | 用途 | 必須/オプション |
|-----------|------|---------------|
| `python-pptx` ≥ 0.6.21 | PPTX生成・操作 | 必須 |
| `lxml` ≥ 4.9 | OOXML直接操作 | 必須（python-pptx依存） |
| `PyYAML` | テーマYAMLファイル読み込み | 必須 |
| `wand` ≥ 0.6 | SVG→PNG変換（ImageMagick binding） | アイコン使用時のみ |
| `anthropic` ≥ 0.18 | Anthropic API呼び出し | `--api-convert`時のみ |
| `openai` ≥ 1.0 | OpenAI API呼び出し | `--api-convert`時のみ |

**原則**: コアパイプライン（JSON→PPTX）は `python-pptx` + `lxml` + `PyYAML` のみで動作する。

---

## 3. モジュール設計

### 3.1 diagram_schema.py

パイプラインの中間表現であるDiagramSpecのデータ構造とバリデーションを定義するモジュール。全クラスはdataclassで定義され、型安全性を確保する。

#### データクラス一覧

| クラス | 責務 | 主要フィールド |
|--------|------|---------------|
| `DiagramSpec` | トップレベル図仕様 | `type`, `direction`, `title`, `class_defs`, `nodes`, `edges`, `groups`, `lanes`, `layout` |
| `Node` | 図内の単一ノード | `id`, `label`, `sublabel`, `shape`, `class_name`, `style`, `group`, `lane`, `icon` |
| `Edge` | ノード間の有向接続 | `from_id`, `to_id`, `label`, `style`, `bus_group` |
| `Group` | ノードのグルーピングゾーン | `id`, `label`, `parent`, `style` |
| `Lane` | スイムレーンバンド | `id`, `label`, `style` |
| `LayoutConfig` | スペーシング・サイジング | `node_width`, `node_height`, `h_gap`, `v_gap` |
| `NodeStyle` | ノードのビジュアルスタイル | `fill`, `border`, `border_width`, `border_dash`, `font_color`, `font_size`, `font_bold` |
| `EdgeStyle` | エッジのビジュアルスタイル | `color`, `width`, `arrow`, `dash` |
| `GroupStyle` | グループのビジュアルスタイル | `border`, `border_dash`, `fill` |
| `LaneStyle` | レーンのビジュアルスタイル | `header_fill`, `header_font_color`, `band_fill`, `border`, `border_width` |

#### バリデーションルール

`DiagramSpec.validate()` が以下の検証を実行する:

- エッジ参照先ノードの存在確認
- ノードのグループ/レーン参照の存在確認
- グループのparent参照の存在確認
- 循環ネスト検出
- ネスト深度制限（最大 `MAX_NEST_DEPTH=3`）
- classDef参照の存在確認
- 重複ノードID検出

#### スタイル解決フロー

`resolve_node_style(node)` メソッドがノードの最終スタイルを計算する。

```
デフォルト NodeStyle → classDefs で上書き → ノード個別 style で最終上書き
```

3層のカスケードにより、デフォルト → クラス → 個別の優先度でスタイルが解決される。`NodeStyle.merge()` メソッドが非デフォルト値のみを上書きする。

### 3.2 diagram_renderer.py（3435行）

パイプラインの中核。DiagramSpecからPPTXスライドを生成する。レイアウト計算、図形描画、コネクタ描画の3フェーズで構成される。

#### 主要関数一覧

| 関数名 | カテゴリ | 責務 |
|--------|---------|------|
| `render_diagram()` | エントリ | メインレンダリングオーケストレーター |
| `render_from_json()` | エントリ | JSON文字列からPPTXファイル生成 |
| `_assign_layers()` | レイアウト | トポロジカルソートによるレイヤー割当 |
| `_order_within_layers()` | レイアウト | Barycenter法による層内ノード順序最適化 |
| `_compute_layout_v2()` | レイアウト | グループ対応 v2 レイアウトエンジン |
| `_compute_layout_swimlane()` | レイアウト | スイムレーン対応 v3 レイアウト |
| `_separate_overlapping_groups()` | レイアウト | グループbbox重複の反復解消 |
| `_classify_edge_route()` | コネクタ | エッジルーティング分類 |
| `_plan_manhattan_route()` | コネクタ | Manhattan経路計算（描画なし） |
| `_compute_port_offsets()` | コネクタ | ポートオフセット計算 |
| `_nudge_overlapping_segments()` | コネクタ | 水平セグメント重なり検出・ナッジ |
| `_draw_planned_path()` | コネクタ | 計画済みパスの描画 |
| `_draw_fan_in_bus()` | コネクタ | Fan-in バスライン描画 |
| `_draw_fan_out_bus()` | コネクタ | Fan-out バスライン描画 |
| `_place_edge_label()` | コネクタ | エッジラベル配置（衝突回避付き） |
| `_draw_connector()` | 描画 | 直線コネクタ描画 |
| `_draw_header_bar()` | 描画 | ヘッダーバー描画 |
| `_draw_swimlanes()` | 描画 | スイムレーンバンド描画 |

### 3.3 diagram_theme.py

テーマシステムの中核モジュール。ThemeConfig dataclassがパレット、フォント、図形スタイル、ノードデフォルトを一括管理する。YAMLファイルからの読み込みに対応し、部分マージ方式を採用。詳細は「7. テーマシステム」を参照。

### 3.4 diagram_cli.py

CLIエントリポイント。argparseで引数解析を行い、3つの動作モードを切り替える。詳細は「8. CLIインターフェース」を参照。

### 3.5 diagram_icons.py

ネットワーク機器アイコンの管理モジュール。15種のビルトインSVGアイコン（Ciscoスタイル線画）を提供する。`get_icon_png_path()` がアイコン名からPNGファイルパスを返す。SVG→PNG変換はwand（ImageMagick）を使用し、変換結果をキャッシュする。

**ビルトインアイコン**: `router`, `switch`, `server`, `database`, `cloud`, `firewall`, `client`, `internet`, `load_balancer`, `wireless_ap`, `storage`, `printer`, `phone`, `vpn`, `monitor`

### 3.6 mermaid_prompt.py

Mermaid→JSON変換用のLLMプロンプトを組み立てるモジュール。`prompts/mermaid_system_prompt.txt`（テンプレート）と `prompts/mermaid_examples.json`（3パターンのFew-shot例: flowchart, network, orgchart）を読み込み、テーマ情報を埋め込んでプロンプトを生成する。

---

## 4. DiagramSpec スキーマ設計

### 4.1 JSON構造

```json
{
  "$schema": "DiagramSpec v1.0",
  "type": "flowchart | network | orgchart",
  "direction": "TB | LR | BT | RL",
  "title": "string (optional)",
  "classDefs": {
    "クラス名": {
      "fill": "#hex", "border": "#hex", "border_width": 1.5,
      "border_dash": false, "font_color": "#FFFFFF",
      "font_size": 11, "font_bold": true
    }
  },
  "nodes": [
    {
      "id": "一意識別子", "label": "表示テキスト",
      "sublabel": "副テキスト (optional)",
      "shape": "rect | rounded_rect | diamond | circle | oval | hexagon",
      "class": "classDefs内のクラス名 (optional)",
      "style": { "...per-node override..." },
      "group": "グループID (optional)",
      "lane": "レーンID (optional)",
      "icon": "アイコン名 or ファイルパス (optional)"
    }
  ],
  "edges": [
    {
      "from": "ノードID", "to": "ノードID",
      "label": "ラベル (optional)",
      "style": { "color": "#hex", "width": 2, "arrow": true, "dash": false },
      "bus_group": "バスグルーピングキー (optional)"
    }
  ],
  "groups": [
    {
      "id": "グループID", "label": "表示名",
      "parent": "親グループID (optional)",
      "style": { "border": "#hex", "border_dash": true, "fill": null }
    }
  ],
  "lanes": [
    {
      "id": "レーンID", "label": "表示名",
      "style": { "header_fill": "#hex", "header_font_color": "#hex", ... }
    }
  ],
  "layout": {
    "node_width": 2.0, "node_height": 0.7,
    "h_gap": 0.5, "v_gap": 0.8
  }
}
```

**必須フィールド**: `type`, `nodes` のみ。他はすべてOptional。

### 4.2 対応図タイプ

| タイプ | 説明 | 代表的なclassDefロール |
|--------|------|----------------------|
| `flowchart` | フローチャート・プロセス図 | terminal, process, decision, error, io |
| `network` | ネットワーク構成図 | external, firewall, core, switch, server, database, app |
| `orgchart` | 組織図 | ceo, vp, team |

### 4.3 shape → MSO_SHAPE マッピング

| DiagramSpec shape | MSO_SHAPE | 用途 |
|-------------------|-----------|------|
| `rect` | `RECTANGLE` | プロセス、サーバー |
| `rounded_rect` | `ROUNDED_RECTANGLE` | 開始/終了、ルーター |
| `diamond` | `DIAMOND` | 判断分岐 |
| `circle` | `OVAL` | イベント、ノード |
| `oval` | `OVAL` | 楕円（横長） |
| `hexagon` | `HEXAGON` | 準備、並列処理 |

### 4.4 グループネスト

`groups[].parent` フィールドにより、最大 `MAX_NEST_DEPTH=3` 階層までのネストをサポートする。子グループは親グループのidをparentに指定する。レイアウトエンジンは bottom-up size → top-down allocation の2パスでネストを処理する。

### 4.5 スイムレーン

`lanes[]` トップレベル配列と `Node.lane` フィールドにより、スイムレーンレイアウトを実現する。

- TB/BT方向 → 縦レーン（横並び、フローは上から下）
- LR/RL方向 → 横レーン（縦並び、フローは左から右）

ノードはレーンとグループの両方に同時に属することができる。

### 4.6 後方互換性ポリシー

- v1.x 内ではフィールド追加のみ（破壊的変更なし）
- 新フィールドはすべて Optional（既存JSONがそのまま動作する）
- `$schema` のバージョン番号でパーサーの振る舞いを切替可能にする

---

## 5. レイアウトエンジン

### 5.1 レイヤー割当（`_assign_layers`）

トポロジカルソートによるレイヤー割当を行う。

1. DFSでバックエッジ（サイクル）を検出
2. バックエッジを除外したDAG上でBFS最長パスを計算
3. ルートノード（入次数 0）からの最大深度を各ノードに割当
4. 非連結ノードはレイヤー 0 に割当

### 5.2 層内順序最適化（`_order_within_layers`）

Barycenter法によるエッジ交差最小化を行う。

**アルゴリズム**:
1. **初期順序**: グループ階層 + JSON元順序でソート
2. **Forward sweep** (Layer 0→N): 各レイヤーで、前レイヤーの接続先の平均位置（barycenter）で並べ替え
3. **Backward sweep** (Layer N→0): 次レイヤーの接続先のbarycentterで並べ替え
4. **4回反復**: Forward + Backward を4回繰り返す

**グループ制約**: 各レイヤー内でノードをグループクラスタに分割し、クラスタ内でのみbarycenter並べ替えを行う。クラスタ自体もメンバーの平均barycentterで並べ替える。

**実績**: Enterprise network テスト（35ノード、49エッジ）で交差 25→19（24%削減）を達成。

### 5.3 レイアウト v2（`_compute_layout_v2`）

グループ対応のメインレイアウトエンジン。

#### Column Packing（Interval Coloring）

グループのレイヤー範囲を区間として扱い、重ならないグループを同一列に配置する。列内の接続密度に基づき、高接続列を中央に配置する。

#### Variable Layer Gaps

| 条件 | ギャップ計算 |
|------|------------|
| グループ境界がレイヤー間にある | `end_pad + visual_gap + start_pad + label_height` |
| 同一グループ内レイヤー間 | `main_gap × 0.25`（コンパクト） |
| Scaled group padding | `max(layout_scale, 0.4)` で鶏卵問題を解決 |

#### Cross-axis Stretch

主軸がボトルネック時にクロス軸スペースを拡張する（`MAX_CROSS_STRETCH=2.5`）。

### 5.4 レイアウト v3（`_compute_layout_swimlane`）

スイムレーン対応のレイアウト。各ノードのレーン所属に基づき、クロス軸方向にレーン幅を計算し、レーン内でノードを配置する。レーンヘッダーの描画情報も `LaneInfo` として返却する。

### 5.5 グループ重複解消（`_separate_overlapping_groups`）

レイアウト後にグループのbboxが重複する場合、反復的に位置を調整して解消する。主軸・クロス軸の両方で分離を行い、margin_topにも対応する。

---

## 6. コネクタルーティング

### 6.1 ルーティング分類（`_classify_edge_route`）

各エッジはソースとターゲットのグループ関係、レイヤー距離、bbox分離度に基づいて4種類に分類される。

| 分類 | 条件 | ルーティング |
|------|------|------------|
| `back_edge` | サイクル検出（DFS） | U-turn routing（右マージン迂回、破線） |
| `cross_group` | 異グループ + Δlayer>3 + bbox分離 | Manhattan 3-segment |
| `l_route` | 異レイヤー + 軸方向オフセット大 | L-shaped routing |
| `direct` | 上記以外 | 直線コネクタ |

### 6.2 2フェーズエッジ描画パイプライン

エッジ描画は3フェーズで実行される。

```python
# Phase 1: パス計画
planned_paths: list[dict] = []
for edge in spec.edges:
    # back_edge: 即座に描画（U-turn）
    # cross_group: _plan_manhattan_route() → planned_paths に追加
    # l_route: パスポイント計算 → planned_paths に追加
    # direct: 即座に描画（_draw_connector）

# Phase 2: Nudge
_nudge_overlapping_segments(planned_paths)

# Phase 3: 描画
for plan in planned_paths:
    _draw_planned_path(slide, plan, theme)
```

**Phase 1（パス計画）**: L-routeとManhattanのパスを計算して `planned_paths` に蓄積する（描画しない）。back_edgeとdirectは即座に描画する。

**Phase 2（Nudge）**: `_nudge_overlapping_segments()` が全計画パスの水平セグメントを分析し、重複を検出してyナッジを適用する。

**Phase 3（描画）**: `_draw_planned_path()` がナッジ済みパスを描画し、ラベル配置を行う。

### 6.3 Manhattan Routing

TB方向では、ソース底面から `clear_y`（ソースグループ下端+0.15"）まで降下、水平移動、ターゲット上面へ降下の3セグメントで構成される。

```
src ─── ┐
        │ (vertical down to clear_y)
        └──────────── ┐ (horizontal)
                      │ (vertical down to target)
                      ▼
                    target
```

`clear_y` ≥ ターゲット上面の場合は側面出口コリドー方式にフォールバックする。

### 6.4 ポートアサインメント（`_compute_port_offsets`）

同一ノードの出入エッジを、隣接ノードのcross-axis位置でソートする。ノード辺上の `[-0.35, +0.35]` 範囲に均等分配し、L-route、Manhattan、direct すべてのルーティングに適用する。これにより、同一ノードからの複数の線が重ならずに分散される。

### 6.5 Nudgeアルゴリズム

`_nudge_overlapping_segments()` は以下のステップで動作する:

1. 全計画パスから水平セグメントを抽出
2. y座標が近い（±73000 EMU ≈ 0.08"）セグメントをクラスタリング
3. 各クラスタ内のx範囲重複をスイープラインで検出
4. 重複グループ内のセグメントを中心から等間隔に分散させる

### 6.6 バスライン統合

バスライン統合には2つの方式が共存する。

#### 明示的 bus_group（最優先）

エッジに `bus_group` キーを指定することで、意図的にバスラインにグルーピングする。

#### 自動検出（Auto-bus）

以下の条件を**すべて**満たすエッジ群を自動的にバス統合する:

- Fan-in（N≥2ソース→1ターゲット）またはFan-out（1ソース→N≥2ターゲット）パターン
- グループ内のエッジにラベルが1つもない
- 全エッジが同一スタイル（color, dash, width一致）
- back-edgeでない

**設計原則**: デフォルト = 統合、例外 = 個別。ラベルやスタイル差は「この接続は特別」のシグナルとして扱う。

```python
def _is_auto_mergeable(edges: list) -> bool:
    if len(edges) < 2: return False
    if any(e.label for e in edges): return False
    styles = {_edge_style_key(e) for e in edges}
    if len(styles) > 1: return False
    return True
```

### 6.7 エッジラベル配置（`_place_edge_label`）

エッジラベルは優先候補リスト（コネクタ中間点、オフセット位置等）から配置される。各候補についてノードBBoxとの衝突判定およびスライド境界制約をチェックし、衝突のない位置を選択する。

---

## 7. テーマシステム

### 7.1 ThemeConfig 構造

```python
@dataclass
class ThemeConfig:
    name: str                          # テーマ名
    palette: Palette                   # 14色のカラーパレット
    fonts: FontConfig                  # heading, body, mono
    node_defaults: NodeDefaults        # 図タイプ別デフォルトclassDef
    diagram_style: DiagramStyle        # 描画レベルデフォルト値
```

| コンポーネント | 型 | 内容 |
|--------------|---|------|
| `name` | `str` | テーマ名（例: "Midnight Executive"） |
| `palette` | `Palette` | 14色のカラーパレット（hex値、#なし） |
| `fonts` | `FontConfig` | heading, body, mono の3フォントファミリー |
| `node_defaults` | `NodeDefaults` | 図タイプ別のデフォルトclassDef |
| `diagram_style` | `DiagramStyle` | 描画レベルのデフォルト値（タイトル、エッジ、グループ、スライド背景、ヘッダーバー） |

### 7.2 YAML部分マージ

`ThemeConfig.from_yaml()` は、Midnight Executiveデフォルトをベースとして、YAMLファイルに指定された項目のみを上書きする部分マージ方式を採用する。省略された項目はデフォルト値を維持するため、カスタムテーマの作成が簡潔に行える。

#### YAMLファイル例

```yaml
name: "Ocean Breeze"
palette:
  navy: "0F3460"
  accent: "16C79A"
fonts:
  heading: "Helvetica"
# 省略した項目はデフォルト値を維持
```

### 7.3 デフォルトパレット（Midnight Executive）

| 名前 | Hex値 | 用途 |
|------|------|------|
| `navy` | `1E2761` | メイン背景色（ダークスライド） |
| `dark_navy` | `141B41` | より暗い背景・パネル |
| `accent` | `3B82F6` | アクセントカラー（青） |
| `teal` | `06B6D4` | セカンダリアクセント |
| `amber` | `F59E0B` | 判断/警告 |
| `ice_blue` | `CADCFC` | ダーク背景上のサブテキスト |
| `mid_gray` | `94A3B8` | コネクタ/外部 |
| `dark_text` | `1E293B` | ライト背景上の本文 |
| `white` | `FFFFFF` | ダーク背景上のメインテキスト |
| `light_gray` | `F5F7FA` | ライト背景色 |
| `panel_gray` | `EDF0F7` | パネル・カード背景 |
| `accent_dark` | `2563EB` | アクセントバリエーション |
| `soft_navy` | `2D3A6E` | パネル用の柔らかいネイビー |
| `card_bg` | `F0F4FF` | カード・コールアウト背景 |

### 7.4 PPTXからのテーマ抽出（`pptx_to_theme.py`）

既存のPPTXテンプレートからThemeConfig YAMLを自動生成するユーティリティ。

```bash
# YAMLファイルに出力
python src/pptx_to_theme.py template.pptx -o themes/my_theme.yaml

# 標準出力に表示
python src/pptx_to_theme.py template.pptx

# 抽出統計を表示
python src/pptx_to_theme.py template.pptx --stats
```

**抽出方法**:

| 項目 | ソース | 精度 |
|------|--------|------|
| palette | スライドレイアウトの `solidFill` 色 + OOXML `clrScheme` | 高（85%一致） |
| fonts | スライドレイアウトの `latin` typeface宣言 | 高（正確に一致） |
| diagram_style | paletteから派生（header_bar, slide_bg等） | 中 |
| node_defaults | 抽出不可（PPTX側に対応概念がない） | デフォルト維持 |

**抽出アルゴリズム**: レイアウトXML内の全 `srgbClr` を `solidFill` コンテキストで収集し、ルミナンスで dark（< 0.25）/ mid（0.25–0.65）/ light（≥ 0.65）に分類。出現頻度でパレットロールに割当てる。

**検証結果**: Midnight Executive テンプレートからの抽出で 14色中12色が完全一致（85%）。ずれた2色（`light_gray` / `card_bg`）はルミナンスが近い色同士の入れ替わりで、実用上の影響なし。

### 7.5 ノードデフォルト（NodeDefaults）

図タイプ別にデフォルトのclassDefスタイルを定義する。LLMプロンプト生成時にも利用される。

```python
# flowchart
"terminal":  {"fill": "#3B82F6", "font_color": "#FFFFFF", "font_bold": True}
"process":   {"fill": "#1E2761", "border": "#3B82F6", "font_color": "#FFFFFF"}
"decision":  {"fill": "#F59E0B", "font_color": "#1E293B"}

# network
"external":  {"fill": "#94A3B8", "border": "#1E293B", "font_color": "#FFFFFF"}
"firewall":  {"fill": "#F59E0B", "font_color": "#1E293B"}
"core":      {"fill": "#1E2761", "border": "#3B82F6", "font_color": "#FFFFFF"}

# orgchart
"ceo":       {"fill": "#141B41", "border": "#3B82F6", "font_color": "#FFFFFF"}
"vp":        {"fill": "#1E2761", "border": "#3B82F6", "font_color": "#FFFFFF"}
"team":      {"fill": "#2D3A6E", "border": "#3B82F6", "font_color": "#FFFFFF"}
```

---

## 8. CLIインターフェース

### 8.1 コマンド例

```bash
# Mode 1: JSON直接入力（デフォルト）
python src/diagram_cli.py input.json -o output.pptx

# Mode 1: JSONバリデーションのみ
python src/diagram_cli.py input.json --validate-only

# Mode 2: Mermaid→API自動変換
python src/diagram_cli.py input.mmd -o output.pptx --api-convert

# Mode 2: OpenAIプロバイダ指定
python src/diagram_cli.py input.mmd -o output.pptx --api-convert --api-provider openai

# Mode 3: プロンプト表示
python src/diagram_cli.py --show-prompt
python src/diagram_cli.py --show-prompt --with-mermaid input.mmd

# カスタムテーマ指定
python src/diagram_cli.py input.json -o output.pptx --theme themes/example_custom.yaml

# テンプレートPPTX使用
python src/diagram_cli.py input.json -o output.pptx -t Midnight_Executive_30_Template.pptx
```

### 8.2 オプション一覧

| オプション | 短縮 | デフォルト | 説明 |
|-----------|------|-----------|------|
| `input` | — | (必須) | 入力ファイル (.json or .mmd) |
| `--output` | `-o` | `diagram_output.pptx` | 出力PPTXファイルパス |
| `--template` | `-t` | なし | ベーステンプレートPPTX |
| `--theme` | — | `midnight_executive` | テーマYAMLファイルパス or ビルトイン名 |
| `--api-convert` | — | `False` | Mermaid入力をLLM APIで自動変換 |
| `--api-provider` | — | `anthropic` | APIプロバイダ (anthropic / openai) |
| `--show-prompt` | — | `False` | システムプロンプトを表示して終了 |
| `--with-mermaid` | — | なし | `--show-prompt`時にMermaidファイルも含める |
| `--validate-only` | — | `False` | JSONのバリデーションのみ実行 |

### 8.3 テーマ解決ロジック

`--theme` 引数は以下の順序で解決される:

1. `"midnight_executive"` または未指定 → デフォルトテーマを使用
2. `.yaml` / `.yml` 拡張子のファイルパス → そのパスを直接読み込み
3. それ以外 → `themes/` ディレクトリから検索し、`.yaml` 拡張子を自動付与して再検索

### 8.4 入力ファイル自動判定

```
拡張子 .json → JSON直接入力モード
拡張子 .mmd  → --api-convert なし: エラー（ヒント付き）
             → --api-convert あり: API自動変換モード
```

### 8.5 バリデーションモード

`--validate-only` は2段階で検証する:

1. **構造診断** (`diagnose_json()`): フィールド存在・未知フィールド・タイポ検出
2. **セマンティック検証** (`parse_diagram_json()`): エッジ参照・グループ参照・循環検出

---

## 9. JSON診断レイヤー

### 9.1 `diagnose_json()` 関数

LLMが出力したJSONの構造的な問題を検出する診断レイヤー。`DiagnosticIssue` オブジェクトのリストを返し、各問題には `level`（error/warning）、`path`（JSONパス）、`message`、任意の `suggestion` が含まれる。

**2つのユースケース**:
1. CLI `--validate-only`: ユーザーに問題を表示
2. API Mode 2: LLMにフィードバックして自己修正

### 9.2 検証項目

| ステップ | 検証内容 | レベル |
|---------|---------|--------|
| JSONパース | 有効なJSONかどうか | error |
| トップレベルフィールド | 必須フィールドの存在、未知フィールド検出 | error / warning |
| type / direction | 列挙値の範囲チェック | error |
| nodes / edges / groups | 配列要素の必須フィールド、shape列挙値 | error / warning |
| styleサブオブジェクト | 未知のスタイルフィールド検出 | warning |
| classDefs | クラス定義内の未知フィールド検出 | warning |
| lanes | レーン要素の必須フィールド検証 | error / warning |
| layout | 未知のレイアウトフィールド検出 | warning |

### 9.3 類似名サジェスト

`_find_similar()` が `SequenceMatcher` を使用し、未知フィールド名と既知フィールド名の類似度を計算する。閾値 0.6 以上の場合に `"Did you mean 'xxx'?"` というサジェストを提供する。これにより、LLMのタイポやスペルミスを自動的に検出・修正提案できる。

### 9.4 既知フィールド定義

```python
_KNOWN_FIELDS_TOP   = {"type", "direction", "title", "classDefs", "nodes", "edges", "groups", "lanes", "layout"}
_REQUIRED_FIELDS_TOP = {"type", "nodes"}

_KNOWN_FIELDS_NODE  = {"id", "label", "sublabel", "shape", "class", "style", "group", "lane", "icon"}
_REQUIRED_FIELDS_NODE = {"id", "label"}

_KNOWN_FIELDS_EDGE  = {"from", "to", "label", "style", "bus_group"}
_REQUIRED_FIELDS_EDGE = {"from", "to"}

_KNOWN_FIELDS_GROUP = {"id", "label", "parent", "style"}
_REQUIRED_FIELDS_GROUP = {"id", "label"}

_KNOWN_FIELDS_LANE  = {"id", "label", "style"}
_REQUIRED_FIELDS_LANE = {"id", "label"}
```

---

## 10. テスト結果・品質指標

### 10.1 Enterprise Network テスト

35ノード、49エッジ、8グループの大規模ネットワーク図で全機能を検証。

| 指標 | 結果 |
|------|------|
| バス統合 | 23本→9バスライン |
| 個別ルーティング | 26本（ラベル付き/スタイル差あり） |
| 交差削減 | 25→19（24%削減） |
| レンダリング | 正常完了 |

### 10.2 ルーティング分類内訳

| 分類 | エッジ数 | 代表例 |
|------|---------|--------|
| auto-bus | 23 | fw_int→web1,2,3, api1→app1,2,3, app1,2,3→cache |
| cross_group | ~7 | prometheus→app1, vault→k8s_master |
| l_route | ~10 | app1→db_master, app3→k8s_master |
| direct | ~9 | core_sw1→core_sw2, prometheus→grafana |

### 10.3 全テストケース

| テスト | 結果 |
|--------|------|
| Enterprise network (35 nodes, 49 edges) | ✓ |
| Flowchart (back-edge付き) | ✓ |
| Fan-in bus (explicit bus_group) | ✓ |
| Fan-out bus (explicit bus_group) | ✓ |
| Auto-merge fan-out (no bus_group) | ✓ |
| No auto-merge when label present | ✓ |
| LR direction flowchart | ✓ |
| Network with dash style | ✓ |
| Crossing minimization diamond | ✓ |

---

## 11. 既知の制限事項

| # | 制限事項 | 影響 | 改善案 |
|---|---------|------|--------|
| 1 | 深い線形フロー（10層以上）で自動スケーリングが強く効きノードが小さくなる | 可読性低下 | 複数スライド分割 |
| 2 | Pure Pythonレイアウトエンジンの品質上限 | 大規模図での配置品質 | Graphviz/ELK等外部エンジンの検討 |
| 3 | LLM出力の非決定性 | JSON構造の微小なずれ | 診断レイヤーで検出・フィードバック |
| 4 | ダイアモンドからの水平コネクタはsnap=False | PowerPointでの編集時に追従しない | OOXML直接操作での対応 |

### 今後のロードマップ

| 優先度 | 機能 | 影響範囲 |
|--------|------|---------|
| 低 | 複数スライド分割 | renderer + cli |
| 低 | ノート/注釈 (annotations[]) | schema + renderer |
| 低 | 条件分岐ラベル位置指定 | schema + renderer |

---

## ディレクトリ構成

```
presentations/
├── ARCHITECTURE.md              ← アーキテクチャ仕様書
├── PROJECT_SPEC.md              ← プロジェクト全体仕様
├── DIAGRAM_PIPELINE_SPEC.md     ← DiagramSpec スキーマ・アルゴリズム詳細
├── DETAILED_DESIGN.md           ← 本ドキュメント（詳細設計書 Markdown版）
├── NAMING_CONVENTION.md         ← レイアウト命名規則
├── HOW_TO_USE.md                ← ダイアグラムパイプライン利用ガイド
│
├── src/
│   ├── diagram_cli.py           ← CLIエントリポイント
│   ├── diagram_renderer.py      ← JSON→PPTX レンダラー (3435行)
│   ├── diagram_schema.py        ← DiagramSpec パーサー・バリデーション
│   ├── diagram_theme.py         ← テーマ定義
│   ├── diagram_icons.py         ← アイコン管理（SVG→PNG変換）
│   ├── pptx_to_theme.py         ← PPTXからテーマYAML抽出ツール
│   ├── mermaid_prompt.py        ← プロンプト組立ユーティリティ
│   ├── icons/                   ← ビルトインSVGアイコン（15種）
│   └── prompts/                 ← LLMプロンプト（データファイル）
│
├── themes/                      ← テーマYAMLファイル
│   ├── midnight_executive.yaml
│   └── example_custom.yaml
│
├── tests/                       ← テストフィクスチャ
│   └── enterprise_network.json
│
└── steps/                       ← ステップ記録
    ├── step_05_complex_diagram_support.md
    ├── step_06_network_icons.md
    ├── step_07_architecture_design.md
    ├── step_08_nested_subgraph.md
    ├── step_09_cli_and_label_fix.md
    ├── step_10_swimlane.md
    ├── step_11_json_diagnostics.md
    ├── step_12_theme_externalization.md
    └── step_13_connector_routing.md
```

---

*作成: 2026-03-29 | バージョン: 1.0*
