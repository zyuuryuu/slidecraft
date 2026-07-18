# Git ブランチ戦略

## ブランチ命名

`claude/<topic>-<session-id>`

session-id は自動付与。topic は英語で簡潔に。

## main は保護されている（直 push 不可・全て PR 経由）

GitHub ruleset（2026-07-18〜）で main は**保護済み**。`git push origin main` は拒否される。**全ての変更は
フィーチャーブランチ → PR → 必須チェック `test` 緑 → マージ**。docs / typo も例外なし（軽微でも PR）。

- **必須チェック**＝`test`（vitest ＋ 型 ＋ typecheck:mcp ＋ lint・fast）。docs-only PR でも `test` は走り
  マージ可（`build`/`e2e` は docs をスキップ）。`build`/`e2e` は非必須だが code PR では回る。
- **require branches up-to-date**：マージ前に main へ rebase＋CI 再実行が要る（merge-only の赤を捕まえる）。
- **bypass なし**（admin 免除も無し）。今回の main 赤 9 日は自作自演だったので escape hatch は置かない。
- ローカルの `.githooks/pre-push` は fast な早期警告（型+lint、main push 時は full test）。ruleset が
  真のゲート。両方が defense-in-depth。

## ブランチ命名 / 作業単位

- 全作業＝別ブランチ（`claude/<topic>-<session-id>`）。engine 横断の型変更・schema.ts リファクタも PR。
- 疎結合セッションは数件単位で1ブランチ→1 PR。

## マージプロトコル

1. PR を作る（`gh pr create`）。CI の `test` が緑になるまでマージ不可（ruleset が強制）。
2. マージ前に diff 確認: `git diff origin/main...HEAD --stat`
3. コンフリクト・main が進んでいる時は rebase（up-to-date 必須）→ CI 再実行を待つ
4. マージ後はリモート・ローカル両方のブランチを削除（`gh pr merge --merge --delete-branch`）
5. **push/merge 後は CI の結果を必ず見る**（緑を確認するまで「完了」と言わない）
