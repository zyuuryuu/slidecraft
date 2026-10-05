# Git ブランチ戦略

## ブランチ命名

`claude/<topic>-<session-id>`

session-id は自動付与。topic は英語で簡潔に。

## main は保護されている（直 push 不可・全て PR 経由）

GitHub ruleset（2026-07-18〜）で main は**保護済み**。`git push origin main` は拒否される。**全ての変更は
フィーチャーブランチ → PR → 必須チェック `test` 緑 → マージ**。docs / typo も例外なし（軽微でも PR）。

- **必須チェック**＝`test`（vitest ＋ 型 ＋ typecheck:mcp ＋ lint・fast）。docs-only PR でも `test` は走り
  マージ可（`build`/`e2e` は docs をスキップ）。`build`/`e2e` は非必須だが code PR では回る。
- **require branches up-to-date**：マージ前に main を**ブランチへ merge**＋CI 再実行が要る（merge-only の赤を捕まえる）。
- **bypass なし**（admin 免除も無し）。今回の main 赤 9 日は自作自演だったので escape hatch は置かない。
- ローカルの `.githooks/pre-push` は fast な早期警告（型+lint、main push 時は full test）。ruleset が
  真のゲート。両方が defense-in-depth。

## ブランチ命名 / 作業単位

- 全作業＝別ブランチ（`claude/<topic>-<session-id>`）。engine 横断の型変更・schema.ts リファクタも PR。
- 疎結合セッションは数件単位で1ブランチ→1 PR。

## PR ブランチへの force-push 禁止（2026-10-05 合意）

**PR を開いたブランチには rebase／force-push をしない。** main への追随は常に
`git merge origin/main`（履歴が汚れても squash マージで畳めるので問題ない）。

- 理由: レビュー統括セッションがマージ列の運用（コンフリクト解消・意味衝突の修正）を**同じブランチに
  push** する。force-push は統括の解消コミットを警告なしで消し得る（2026-10-05 の Wave 3 で実際に
  解消 push の直前に force-push が重なり、作り直しが発生した）。
- 履歴の整形が必要なら統括がマージ時に squash で行う（PR 本文にその旨を書けばよい）。
- 例外は**統括セッションのみ**・かつ「マージ済み履歴だけを含むブランチの作り直し」
  （`--force-with-lease` 限定）。実装セッションに例外はない。
- 自分のブランチに自分以外のコミット（統括の解消マージ等）が現れたら、**取り込んで続ける**
  （`git pull` → 続行）。巻き戻さない。

## マージプロトコル

1. PR を作る（`gh pr create`）。CI の `test` が緑になるまでマージ不可（ruleset が強制）。
2. マージ前に diff 確認: `git diff origin/main...HEAD --stat`
3. コンフリクト・main が進んでいる時は **main をブランチへ merge**（up-to-date 必須）→ CI 再実行を待つ。
   **rebase は使わない**（下記「force-push 禁止」）
4. マージ後はリモート・ローカル両方のブランチを削除（`gh pr merge --merge --delete-branch`）
5. **push/merge 後は CI の結果を必ず見る**（緑を確認するまで「完了」と言わない）
