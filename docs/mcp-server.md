# SlideCraft MCP サーバ（`slidecraft serve`）

上流の AI エージェント（Claude Desktop / Claude Code など）から SlideCraft を駆動するための
**headless な stdio MCP サーバ**。エージェントがスライドの「中身」を考え、SlideCraft の
**決定論エンジン**がレイアウト・分割・検証・PPTX 生成を担う（harness-over-model）。

- **エージェント＝LLM**：サーバ自身は LLM を呼ばない。公開するのは決定論的な engine 操作だけ。
- **headless**：webview もブラウザも不要（Node プロセス）。WSL2 の GUI 問題とは無関係。
- **--no-fs（v1）**：`.slidecraft` / `.pptx` のバイト列は **base64 で stdio をやり取り**する。
  サーバはファイルシステムに一切触れない（信頼境界は「起動した親エージェント」＝OSユーザ）。

---

## ビルドと起動

```bash
npm install
npm run build:mcp        # → dist/mcp/cli.js を生成（esbuild, Node ESM）
node dist/mcp/cli.js      # stdio で MCP サーバとして待機（通常はエージェントが spawn する）
```

`--root` を渡すと現状はエラー終了する（scoped fs は次バージョン）。v1 は `--no-fs` のみ。

---

## エージェントへの接続（例：Claude Desktop）

`claude_desktop_config.json` の `mcpServers` に登録する（パスは絶対パス）：

```json
{
  "mcpServers": {
    "slidecraft": {
      "command": "node",
      "args": ["/absolute/path/to/slidecraft/dist/mcp/cli.js"]
    }
  }
}
```

Claude Code なら `claude mcp add slidecraft -- node /absolute/path/to/slidecraft/dist/mcp/cli.js`
相当の登録でよい。登録後、エージェントから下記ツールが見える。

---

## ツール一覧（17）

入口は2つ：既存プロジェクトを開く `open_project`、テンプレ＋内容から新規作成する `new_project`。

| 種別 | ツール | 内容 |
|---|---|---|
| 開く | `open_project(dataBase64)` | base64 の `.slidecraft` を読み込み（deck+template+catalog）。`{slideCount, diagnostics}` |
| 新規 | `new_project(templateBase64, markdown?)` | base64 の `.pptx` テンプレ＋（任意）Markdown から新規作成（GUI の Draft と同じ parseMd→distill 整形）。`{slideCount, diagnostics}` |
| 読む | `get_deck` / `get_deck_markdown` | deck（DeckIR JSON）/ deck 全体の Markdown |
| 読む | `get_slide_markdown(index)` | 1スライドの Markdown（auto レイアウト解決済み） |
| 読む | `get_deck_issues` | 診断（split/condense/visualize/title レバー付き） |
| 読む | `get_template_capabilities` | テンプレートの能力サマリ＋レイアウト一覧（生成の文脈） |
| 読む | `get_project_info` | テンプレート名・スライド数・dirty 等 |
| 読む | `get_slide_fix_request(index)` | 修正リクエスト packet（**エージェントが LLM として埋める**） |
| 編集 | `set_slide_markdown(index, markdown)` | 1スライドを差し替え（zod 検証・不正は never-silent で拒否） |
| 編集 | `set_deck_markdown(markdown)` | deck 全体を差し替え |
| 編集 | `split_overflowing_slides` | 決定論レバー：溢れた本文をフォント縮小なしで分割 |
| 編集 | `convert_bullets_to_table(index)` | 決定論レバー：key-value 箇条書き → GFM 表 |
| 編集 | `set_slide_diagram(index, source, format)` | 図を DiagramSpec(yaml/json) or Mermaid で設定（検証＋native YAML 化。図/mermaid を持つスライドのみ。Mermaid はブラケットのノードラベル `A[label]` が必要） |
| 検証 | `validate_deck` | deck 検証＋`exportReadiness`（変換不能 mermaid スキャン） |
| 保存 | `save_project` | `.slidecraft` を生成し `{dataBase64}` で返す |
| 出力 | `export_pptx(onUnsupportedMermaid?)` | `.pptx` を **native-vector で headless 生成**し `{dataBase64, skipped}` |

各ツールは結果 JSON を返し、エンジンのエラーは `isError` で返す。

---

## 典型的なループ（エージェント視点）

1. ローカルの `.slidecraft` を**自分のファイルツールで読み**、base64 化して `open_project`。
2. `get_deck_issues` で課題（溢れ・冗長・表化候補・タイトル）を把握。
3. 決定論で済むものは即適用：`split_overflowing_slides`（溢れ分割）/ `convert_bullets_to_table`（表化）。
4. 文章の手直しが要るスライドは `get_slide_fix_request(i)` で制約＋診断の packet を取得 →
   **エージェントが Markdown を書き** → `set_slide_markdown(i, md)` で適用（戻り値の
   `diagnostics` で改善を確認）。
5. `validate_deck` で `exportReadiness` を確認。
6. `export_pptx` の `dataBase64` を**自分で `.pptx` に書き出す**（または `save_project` で
   `.slidecraft` を保存）。

> エンジンが「正しいレイアウト・フォント維持・テンプレ準拠」を保証するので、エージェントは
> **内容に集中**できる。これが harness-over-model の狙い。

---

## PPTX 出力の制約（headless）

- 14 種のネイティブ図と表は **編集可能な PPTX シェイプ**として出る（ラスタライザ不要）。
- 変換可能な Mermaid は自動でネイティブ図になる。
- **変換不能な Mermaid（gitGraph / sankey / C4 等）は headless では描けない**ため、
  `export_pptx` は既定で **reject**（無言消失させない）。`onUnsupportedMermaid: "skip"` を
  渡すと当該スライドを省略し `skipped` で報告する。`validate_deck` の `exportReadiness` で事前に分かる。

---

## データの送信（egress）について

- `slidecraft serve` 自身はクラウドにも LLM にも送信しない。
- ただし**エージェントに接続した時点で、deck の内容はそのエージェントのモデルに渡る**。
  これは「接続する」という選択そのものが opt-in の egress。機密スライドを扱う場合は、
  どのエージェント（ローカル/クラウド）に繋ぐかで判断する。
- GUI 側の AI Assist には別途「ローカルモデル限定モード」があり、そちらは GUI→LLM の
  送信を統治する（MCP 経路とは別の境界）。

---

## v1 の制限（今後の拡張）

- `--no-fs`（base64）のみ。`--root`（プロジェクトディレクトリ配下に限定した scoped fs）は次版。
- `generate_from_plan`（DeckPlan からの新規生成）・`apply_design_intent`（空間意図）の
  ツールは未実装。
- リソース（`deck://current` 等の MCP resource）は未提供（現状は tool 結果で deck 状態を返す）。
