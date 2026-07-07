# 開発・貢献ガイド

SlideCraft の開発に参加していただきありがとうございます。このページは、ソースコードから
SlideCraft を動かし、変更を加え、テストして、Pull Request を送るまでの流れをまとめたものです。

「使うだけ」であればソースは不要です（配布インストーラの入手は[インストール](/guide/installation)を参照）。
ここから先は**開発者向け**の内容です。

::: tip このページの前提
コマンドはすべてリポジトリのルートで実行します。パッケージマネージャは `npm` を使います。
:::

---

## 1. 開発環境の構築

### 前提ツール

| ツール | バージョン | 用途 |
|---|---|---|
| Node.js | 20 以上 | フロントエンド・テスト・MCP |
| Rust | 1.70 以上 | Tauri（デスクトップシェル）のビルド |

Linux では、Tauri のビルドに以下のシステムパッケージが必要です（Debian/Ubuntu 系のパッケージ名）：

```bash
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev libssl-dev patchelf
```

::: details Rust がまだ入っていない場合
[rustup](https://rustup.rs/) で導入するのが簡単です。`cargo --version` が通れば準備完了です。
Rust は Tauri（デスクトップアプリ）のビルドにのみ必要で、ブラウザでフロントだけ触る分には不要です。
:::

### クローンと依存インストール

```bash
git clone git@github.com:zyuuryuu/slidecraft.git
cd slidecraft
npm install
```

### 起動する

用途に応じて 2 通りの起動方法があります。

```bash
npm run dev          # Vite dev server のみ（localhost:5173、ブラウザで開発）
npm run tauri dev    # Tauri + Vite を同時起動（デスクトップアプリとして開発）
```

- **`npm run dev`** — ブラウザだけで UI を素早く回したいときに。Tauri（Rust）のビルドを待たずに済みます。
  内蔵オフライン AI やデスクトップ限定の永続化など、Tauri IPC に依存する機能は動きません。
- **`npm run tauri dev`** — デスクトップアプリ本体として動かします。初回は Rust のコンパイルに時間がかかります。

::: tip WSL で開発する場合
WSL では Tauri の起動に追加設定が要ることがあります。`npm run tauri:wsl`
（`scripts/tauri-dev-wsl.sh` のラッパー）が用意されています。
:::

デスクトップ・ブラウザの二重運用や AI 統合の考え方は[AI設定](/guide/ai-setup)、
上流エージェント連携は[MCP](/guide/mcp)を参照してください。

---

## 2. テスト

SlideCraft は**テストファーストで実装する**方針（後述の規約 R3）です。まずテストを書いて
失敗を確認し、それから実装します。

### ユニットテスト（Vitest）

```bash
npm test              # 全ユニットテストを 1 回実行（vitest run）
npm run test:watch    # 変更を監視して再実行（開発中）
```

エンジンの座標計算やプレースホルダー流し込みなど、ロジックの中核はここで守られています。

### 型チェック

`npm test`（Vitest / esbuild）は**型を検査しません**。テストが緑でも `tsc` が壊れていることが
あり得ます。「完了」の前に必ずビルド／型チェックを通してください。

```bash
npm run build           # tsc -b（型チェック）+ vite build（フロントの本番ビルド）
npm run typecheck:mcp   # MCP サーバ側の型チェック（tsconfig.mcp.json）
```

::: warning テストが緑でも型は別
`npm test` が通っても `npm run build`（`tsc -b`）が落ちることがあります。
フロント側は `npm run build`、MCP 側は `npm run typecheck:mcp` の両方を通すのを習慣にしてください。
:::

### E2E テスト（Playwright）

```bash
npm run test:e2e      # ブラウザ操作を含む E2E（playwright test）
```

::: warning ドラッグ操作のテスト
Tauri の WebView（WebKitGTK / WKWebView）ではネイティブ HTML5 ドラッグ＆ドロップが壊れます。
DnD はポインタイベントで実装しており、E2E でも `dragTo` は誤って緑になるため使いません
（`mouse.down` / `move` / `up` を直接組み立てて検証します）。
:::

### リント

```bash
npm run lint          # ESLint
```

### 提出前チェックリスト

PR を出す前に、少なくとも次の 3 つが緑であることを確認してください。

```bash
npm test              # ユニットテスト
npm run build         # 型チェック + フロントビルド
npm run typecheck:mcp # MCP 型チェック
```

---

## 3. ブランチと Pull Request のフロー

### ブランチ命名

```
claude/<topic>-<session-id>
```

`topic` は英語で簡潔に。`session-id` は自動付与されます。

### どこで作業するか

| 状況 | 作業場所 |
|---|---|
| 独立した機能追加（新テーマ・新アイコン・新テストスイート） | **別ブランチ** |
| Sub Agent に委任するタスク | **別ブランチ** |
| E2E テスト／インストーラ作業 | **別ブランチ** |
| `src/engine/` 内の複数ファイルにまたがる型変更 | **main 直接**（波及が大きい） |
| `schema.ts` の変更を伴うリファクタ | **main 直接** |
| typo・コメント修正などの軽微な変更 | **main 直接** |

### マージのプロトコル

1. 履歴保持のため **PR を推奨**します。軽微なフォローアップは直接マージ可。
2. マージ前に diff を確認：`git diff HEAD origin/<branch> --stat`
3. コンフリクトが出たらユーザーに確認してから解決します。
4. マージ後は**リモート・ローカル両方**のブランチを削除します。

::: tip GitHub 操作は gh CLI で
PR / Issue の作成や API 呼び出しは `gh` CLI を使います。対話フラグ（`git rebase -i` など）は
この環境ではサポートされていない点に注意してください。
:::

---

## 4. コーディング規約の要点

詳細はリポジトリの `CLAUDE.md` にありますが、変更時に特に効いてくるのが次の 4 点です。

### R1: 1 ファイル 400 行以下

保守性のための上限です。超えたらモジュール分割します。`layout-engine.ts` は歴史的に
大きめですが、**これ以上の肥大化は禁止**です。

### R2: `engine/` は純粋ロジック（DOM / Tauri API 禁止）

`src/engine/` 配下は Node.js / ブラウザ / Tauri のいずれの API にも依存しない、
純粋な計算ロジックだけにします。DOM 操作や Tauri IPC は `src/components/` または
`src/ipc/` に閉じ込めてください。これによりエンジンをそのままテスト・MCP・プレビューで再利用できます。

### R3: テストファースト

新機能もバグ修正も、**先にテストを書いて失敗を確認**してから実装します（第2章参照）。

### R4/R5: 図の座標は Python 参照と ±1% 互換

`layout-engine.ts` の座標計算は、Python 版の参照実装（`diagram_renderer.py`）と
**±1% 以内**で一致させます。ゴールデンファイルテストで検証されるため、座標ロジックを
触ったらこの許容誤差を割らないことを確認してください。

::: warning ユーザー確認が要る変更
`schema.ts` の型（`DiagramSpec` / `Node` / `Edge` など）の変更は全モジュールに波及します。
着手前に必ずユーザーに確認してください。`layout-engine.ts` の座標ロジック変更や、
複数 `engine/` ファイルにまたがるリファクタも、Sub Agent へは委任せずメインで扱う対象です。
:::

### やってはいけないこと

- `any` 型の濫用（必要最小限に）
- `// @ts-ignore` / `// @ts-expect-error` の安易な使用
- `console.log` デバッグの残し込み（開発中の一時利用を除く）
- ハードコードされたシークレット / API キー
- `.skip` によるテストの無効化
- テストのアサーション弱体化（`toEqual` → `toBeTruthy` への格下げなど）
- ワークアラウンドで済ませること — **原因を特定して根本修正**します（R6）

図の仕様や種類（`diagram` の 12 種＋`mermaid` 経由の 4 種）については[図](/guide/diagrams)を参照してください。
埋め込み画像は `data:` URI のみ、`gitGraph` / `sankey` / `C4` は PPTX に出力できない、といった制約は
[Markdown](/guide/markdown-authoring) と [FAQ](/guide/faq) にまとまっています。

---

## 5. コミットメッセージ規約

```
<type>: <簡潔な説明>

<詳細（任意）>

NEXT: <次にやるべきこと — ファイル名と変更内容を1行で>
```

**type** は次のいずれか：`feat` / `fix` / `refactor` / `test` / `docs` / `chore`。

`NEXT:` 行は、作業を中断したときの引き継ぎに使います。次に触るファイル名と変更内容を 1 行で残します。

```text
feat(image): 最背面レイヤー — 既存を壊さず画像を背面に敷く

コンテンツありのスライドは自動で behind に切り替える。

NEXT: image-layer.ts のリセットボタン挙動をラベルと一致させる
```

---

## 6. ADR（アーキテクチャ決定記録）の運用

重要または不可逆で、かつ理由が自明でない設計判断をしたら、`docs/adr/` に **ADR を 1 本**追加します。

### 書き方と原則

- 番号を 1 つ増やして採番します（例：次は `0022-...md`）。
- 各 ADR は **`Context / Decision / Consequences / References`** の 4 節で書きます。
- ADR は原則 **immutable（変更しない）**。決定を覆すときは、古い ADR を書き換えず、
  **新しい ADR で supersede** し、古い方の Status を `Superseded` に変えます。
- 一覧表（`docs/adr/README.md`）にも 1 行追加します。

### ドキュメントは役割で分ける

| 種類 | 置き場所 | 性質 |
|---|---|---|
| 決定の記録 | `docs/adr/` | 決定済み＆実装済み。immutable |
| 前方向きの計画 | `docs/ROADMAP.md` | 将来項目のみ。**完了したら表から外す**（履歴は ADR ＋ git に残る） |
| 詳細設計 | `docs/design/` | ADR から参照する補助資料 |
| 使い方 | `docs/mcp-server.md` など | エンドユーザ／連携者向けガイド |

機能やフェーズが完了したら、(1) 該当 ADR を追加または更新し、(2) ROADMAP から完了項目を除去し、
(3) テスト数は git コミット / PR に記録します。

::: tip どんなときに ADR を書く？
判断基準は 2 軸です — **重要・不可逆かどうか** × **理由が非自明かどうか**。
両方に当てはまるものだけを ADR にします。自明な小変更まで ADR 化する必要はありません。
:::

---

## 7. リリースについて

リリースはメンテナが行います。バージョンは `src-tauri/tauri.conf.json` を単一ソースとし、
他のファイルへは `npm run version:set <x.y.z>` で自動伝播します（手で個別に書き換えない）。
手順の詳細はリポジトリの `RELEASING.md` を参照してください。

---

## 関連ページ

- [インストール](/guide/installation) — 配布版の入手（開発不要のユーザー向け）
- [Markdown](/guide/markdown-authoring) — 記法と制約
- [図](/guide/diagrams) — 12 種のネイティブ図＋`mermaid` 経由の 4 種
- [テンプレート](/guide/templates) — 見た目の源
- [AI設定](/guide/ai-setup) — 内蔵オフライン AI
- [MCP](/guide/mcp) — 上流エージェント連携
- [FAQ](/guide/faq) — よくある質問
