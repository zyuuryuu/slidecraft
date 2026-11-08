<!-- Thanks for contributing! See CONTRIBUTING.md. -->

## What & why

<!-- What does this change, and why? Link any related issue. -->

## UX への影響 / UX impact

<!-- GUI を触らない PR は「該当なし」の 1 行でよい。 / If this PR does not touch the GUI, write "N/A" on one line.
     予算（ボタン数・帯・メニュー区画・ネスト・✨/＋ の記号・i18n 漏れ）は tests/ux-budget.test.tsx が検査する。
     予算を上げる・凍結リストに足すときは、その理由をここに書く（ADR-0039）。 -->

1. 常設のボタン・帯・モーダル・設定を足したか（足したなら何を・なぜ常設か）:
2. 既存の入口を動かした・増やしたか（同じ機能への入口が 2 つにならないか）:
3. 新しい記号・文言は 1 対 1 か（✨＝AI・＋＝追加）・i18n の辞書を通しているか:
4. 新機能の複雑さを誰が負うか（AI／既定値／段階的開示／利用者）:

## Checklist

- [ ] Tests added/updated and `npm test` is green
- [ ] `npm run build` passes (type check)
- [ ] No duplicated computation of the same meaning across paths — unified, or covered by an agreement test (CLAUDE.md R8 / ADR-0031)
- [ ] Conventional commit type (`feat` / `fix` / `docs` / `refactor` / `test` / `chore`)
- [ ] Docs updated if behavior/usage changed
- [ ] For security-sensitive changes, followed [SECURITY.md](../SECURITY.md)
