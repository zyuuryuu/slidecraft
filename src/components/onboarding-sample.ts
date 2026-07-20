/**
 * onboarding-sample.ts — the Markdown loaded by Onboarding's "サンプルを見る" action (Issue #259).
 * Plain data only, no engine involvement: App feeds it through the exact same handleEditorChange
 * pipeline normal typing uses, so it's just an ordinary Draft that the user can tweak or discard.
 */
export const ONBOARDING_SAMPLE_MD = `# SlideCraft へようこそ

- Markdown を書く → テンプレを選ぶ → .pptx を書き出す
- このスライドはサンプルです。自由に編集して試せます

# 次のステップ

- 左のスライド一覧から追加・削除
- 右のプレビューで仕上がりを確認
- 「確定」で編集画面へ進みます
`;
