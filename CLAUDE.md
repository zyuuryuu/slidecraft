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
npm test                 # vitest run (118 tests)
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

## 設計パラメータ

| パラメータ | 値 | 根拠 |
|-----------|-----|------|
| スライドサイズ | 13.33 x 7.5 inch (16:9) | PowerPoint 標準 |
| ノード最大幅 | 2.5 inch | Python 版準拠 |
| レイヤー間隔 (TB) | 1.2 inch | Python 版準拠 |
| レイヤー間隔 (LR) | 1.8 inch | Python 版準拠 |
| 座標許容誤差 | ±1% | ゴールデンファイルテスト基準 |
| ファイル行数上限 | 400 行 | 保守性確保 |
