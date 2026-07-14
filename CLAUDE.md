# SlideCraft — Claude Code ガイド

> Tauri v2 + TypeScript + React + PptxGenJS
> YAML/JSON → PPTX 変換デスクトップアプリ

---

## クイックリファレンス

```bash
# 開発
npm run dev              # Vite dev server (localhost:5173)
npm run tauri dev        # Tauri + Vite 同時起動

# テスト
npm test                 # vitest run (918 tests)
npm run test:watch       # vitest watch mode

# ビルド
npm run build            # tsc + vite build
npm run tauri build      # インストーラ生成 (.msi / .dmg / .AppImage)

# リント
npm run lint             # eslint
```

---

## コーディングルール

### R1: 1 ファイル 400 行以下
超過時はモジュール分割する。`layout-engine.ts` は例外的に大きいが、これ以上の肥大化は禁止。

### R2: engine/ は純粋ロジック — DOM / Tauri API 禁止
`src/engine/` 内のモジュールは Node.js / ブラウザ API に依存しない純粋な計算ロジックのみ。
Tauri IPC・DOM 操作は `src/components/` または `src/ipc/` に閉じる。

### R3: テストファーストで実装
新機能・バグ修正は先にテストを書き、失敗を確認してから実装する。

### R4: schema.ts の変更はユーザ確認必須
`DiagramSpec` / `Node` / `Edge` 等の型変更は全モジュールに波及する。変更前に必ずユーザに確認を取る。

### R5: Python 参照コードとの座標互換性を維持
`layout-engine.ts` の座標計算は Python 版 `diagram_renderer.py` と ±1% 以内の誤差で一致すること。
ゴールデンファイルテストで検証する。

### R6: ワークアラウンド禁止 — 根本原因を修正
エラー調査 → 原因特定 → 根本修正の順で対処する。

### R7: PptxGenJS の制約を意識する
`fit: "shrink"` は PowerPoint 側で即時反映されない場合がある。
長いテキストにはレンダラー側でフォントサイズ事前計算を行う。

---

## 禁止事項

- `any` 型の濫用（必要最小限に留める）
- `// @ts-ignore` / `// @ts-expect-error` の安易な使用
- `console.log` デバッグ（開発中の一時利用を除く）
- ハードコードされたシークレット / API キー
- `@vitest.skip` によるテストの無効化
- テストのアサーション弱体化（`toEqual` → `toBeTruthy` 等への格下げ）

---

## コミットメッセージ規約

```
<type>: <簡潔な説明>

<詳細（任意）>

NEXT: <次にやるべきこと — ファイル名と変更内容を1行で>
```

**type**: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

`NEXT:` セクションはセッション中断時の引継ぎに使用する。

---

## テスト / デバッグ規約

- エラー発生時はまず原因を調査してから修正に着手する
- テストファイルの変更（アサーション変更含む）はユーザ確認が必要
- コード変更のみであれば確認不要で進めてよい

---

## Sub Agent 活用ガイド

**委任に適するタスク**:
- 新しいテストケースの追加
- コードレビュー / 影響範囲分析
- Python 参照コードの調査
- 新アイコン SVG の追加

**委任に不適なタスク**（メインセッションで実施）:
- `schema.ts` の型変更
- `layout-engine.ts` の座標計算ロジック変更
- 複数 engine/ ファイルにまたがるリファクタ

---

## ドキュメント同期ルール

- ファイル作成 / 移動 / 削除時 → 必要に応じて README を更新
- マイルストーン完了時 → 設計書の Phase ステータスを更新

---

## 課題・記録の置き場（Issue 中心）

作業・決定・文脈を置き場で分離する。複数マシン / エージェントで動かすため、**「やること」は
GitHub Issue に集約**する（唯一の共有作業キュー）。

| 置き場 | 中身 | 補足 |
| --- | --- | --- |
| **GitHub Issue** | やること（bug / task / 残作業） | open→closed で追跡・修正コミットは `Fixes #N` で紐づけ・本文に repro / root cause / fix 方針 |
| **ADR**（`docs/adr/`） | 不可逆な決定と理由 | Issue は閉じるが ADR は永続記録 |
| **`docs/design/`** | 設計仕様 | work item でなく coherent な spec |
| **`docs/ROADMAP.md`** | 前方の計画＝高レベルのテーマのみ | 粒度の細かい作業項目は Issue へ |
| **`docs/shipped.md`** | 出荷ログ（1 機能 1 行） | — |
| **memory**（`~/.claude/…`） | ユーザ / プロジェクトの非自明な前提（好み・north star） | 私の作業文脈。Issue で代替しない |

- **バグ / 気になる挙動を見つけたら memory や docs に書かず、`gh issue create` で Issue を切る。**
- commit の `NEXT:` や ROADMAP に残作業プロズを溜めない — Issue 化する。
- `gh issue view` は projects-classic の deprecation で失敗する。本文取得は
  `gh api repos/OWNER/REPO/issues/N --jq '.title, .body'` を使う。

### Issue の自己完結基準（疎結合セッションが単独で取れるように）

各セッションが数件単位で独立に着手できるよう、Issue は**それ単独で読んで着手できる**こと。起票時も
着手時（不足を補う）も、次を満たす：

- **repro / root cause / 触点（`file:line`）/ fix 方針** を本文に書く。
- **現状・着手点** を 1 行：関連コードの現在地と「何が既にあるか」（例:「`inferFunction` は figure も
  判定済＝`master-scorer.ts`。これを復元に使う」）。fresh セッションが最初に読むファイルを示す。
- **壊してはいけない不変条件** を明記：健全テンプレ **byte-identical**・共有 painter / PPTX は
  **golden 必須**・**test-first（R3）**・binding は **no-silent-drop / do-no-harm** 等、該当するもの。
- **受け入れ基準**：先に書くべきテストを 1 行。
- **サイズ**：1 セッションを超えるなら**分割**。依存は本文に「blocked by #N」。会話固有の略語（②a 等）は
  本文で 1 語説明する。

**とりまとめ（triage）**：起票された Issue はこの基準に揃える（不足を補筆・重複を `duplicate` で閉じ・
分割・`good first issue` 付与・依存順の明記）。閉じられた Issue がマイルストーンなら [shipped.md](docs/shipped.md) に 1 行追記。

---

## 設計パラメータ

| パラメータ | 値 | 根拠 |
|-----------|-----|------|
| スライドサイズ | 13.33 x 7.5 inch (16:9) | PowerPoint 標準 |
| ノード最大幅 | 2.5 inch | Python 版準拠 |
| レイヤー間隔 (TB) | 1.2 inch | Python 版準拠 |
| レイヤー間隔 (LR) | 1.8 inch | Python 版準拠 |
| 座標許容誤差 | ±1% | ゴールデンファイルテスト基準 |
| ファイル行数上限 | 400 行 | 保守性確保 |
