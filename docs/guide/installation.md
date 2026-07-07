# インストール

SlideCraft は Windows / macOS / Linux 向けのデスクトップアプリです。通常は各 OS 用の配布インストーラを
[Releases](https://github.com/zyuuryuu/slidecraft/releases) から入手します。ソースからの開発起動も可能ですが、
一般利用では不要です。

このページでは次を扱います。

- [配布インストーラの入手（OS 別）](#配布インストーラの入手-os-別)
- [macOS の初回起動（ad-hoc 署名の注意）](#macos-の初回起動)
- [ソースからの開発起動](#ソースからの開発起動)

インストール後の使い方は [Markdown 記法](/guide/markdown-authoring)・[図](/guide/diagrams)・[テンプレート](/guide/templates)
を、うまくいかないときは [FAQ](/guide/faq) を参照してください。

---

## 配布インストーラの入手（OS 別）

[Releases](https://github.com/zyuuryuu/slidecraft/releases) の各バージョンに、OS 別のインストーラが添付されています。

| OS | 形式 | 入手・導入 |
|---|---|---|
| Windows | `.msi`（推奨）/ `.exe` | ダウンロードして実行 |
| macOS | Homebrew cask（推奨）/ `.dmg` | 下記コマンド。Apple Silicon 用 `_aarch64.dmg` と Intel 用 `_x64.dmg` |
| Linux | `.AppImage`（推奨）/ `.deb` / `.rpm` | AppImage は実行権限を付けて起動、または deb / rpm を導入 |

### Windows

`.msi` をダウンロードして実行するのが最も簡単です。同じリリースには `.exe`（NSIS）インストーラも
添付されている場合があります。どちらもインストール後はスタートメニューから起動できます。

::: tip SmartScreen の警告
未署名の場合、初回に Microsoft Defender SmartScreen が警告を出すことがあります。
「詳細情報」→「実行」で起動できます。
:::

### Linux

配布形式は 3 種類です。ディストリビューションに合わせて選びます。

**AppImage（どのディストリでも動く。推奨）**

```bash
chmod +x SlideCraft_0.1.0_amd64.AppImage
./SlideCraft_0.1.0_amd64.AppImage
```

**Debian / Ubuntu 系（.deb）**

```bash
sudo apt install ./SlideCraft_0.1.0_amd64.deb
```

**Fedora / RHEL 系（.rpm）**

```bash
sudo dnf install ./SlideCraft-0.1.0-1.x86_64.rpm
```

::: details AppImage が起動しない場合
古いディストリでは FUSE が必要です。`libfuse2` を導入するか、`--appimage-extract-and-run` で
展開実行してください。

```bash
sudo apt install libfuse2          # Debian/Ubuntu
./SlideCraft_0.1.0_amd64.AppImage --appimage-extract-and-run
```
:::

### macOS

macOS ビルドは **ad-hoc 署名（`codesign -s -`）**で配布され、**Apple のノータライズは行っていません**
（Apple Developer プログラム $99/年 を要しないため）。この方針では **Homebrew cask 経由が最もクリーン**です。

```bash
# tap 経由（一発）
brew install --cask zyuuryuu/slidecraft/slidecraft

# もしくは tap を追加してから
brew tap zyuuryuu/slidecraft
brew install --cask slidecraft
```

`brew install --cask` はインストール時に `com.apple.quarantine` 属性を剥がします。多くの環境ではこれで初回警告なしに開けますが、**新しめの macOS（Sequoia 15 以降）では未ノータライズのため、初回に「"SlideCraft" は Mac に問題を起こす可能性がある…」という警告が出ることがあります**（破損ではありません）。その場合は次で開けます:

**システム設定 → プライバシーとセキュリティ →（下の方の）「"SlideCraft" は…ブロックされました」→「このまま開く」** → 再確認ダイアログで「開く」。一度許可すれば次回以降は通常起動できます。

::: tip macOS 15 以降のヒント
macOS 15（Sequoia）以降では、従来の「右クリック →『開く』」だけでは通らなくなっており、上記の **システム設定 →「このまま開く」** が確実な方法です。これは未ノータライズアプリ全般の挙動で、根本解決は Developer-ID 署名＋ノータライズ（$99・下記「将来」）です。
:::

::: tip AI エージェントから使う（ビルド不要）
Homebrew でインストールすると、上流 AI（Claude Code / Cursor / Claude Desktop）から SlideCraft を駆動する MCP サーバも**同梱・PATH 登録**されます（v0.1.1 以降）。ソースの clone もシステム Node も不要で、`claude mcp add slidecraft -- slidecraft-mcp` で登録できます。詳細は [MCP ガイド](/guide/mcp) を参照してください。
:::

::: warning macOS で直接 .dmg を開く場合の初回注意
Homebrew を使わず `.dmg` を直接ダウンロードすると quarantine 属性が残るため、Gatekeeper が
「"SlideCraft" は壊れているため開けません」または「開発元を確認できません」と表示して**そのままではブロック**します。
これは ad-hoc 署名（未ノータライズ）由来で、破損ではありません。次のどちらかで解決します。

**方法 A — 右クリックで開く（GUI）**
`/Applications` の SlideCraft.app を Control キーを押しながらクリック（または右クリック）→ **「開く」** →
ダイアログで再度 **「開く」**。一度許可すれば次回以降は通常起動できます。

**方法 B — quarantine 属性を剥がす（ターミナル）**

```bash
xattr -dr com.apple.quarantine /Applications/SlideCraft.app
```

Apple Silicon（M シリーズ）は未署名バイナリを一切実行できないため ad-hoc 署名は必須ですが、
同梱の `node` / `llamafile`（[内蔵オフライン AI](/guide/ai-setup) 用）も個別に ad-hoc 署名済みです。
上記いずれかで App 本体の quarantine を剥がせば、これらも問題なく起動します。
:::

::: tip 将来: ノータライズ経路
直接 .dmg を quarantine 剥がしなしで開けるようにする（=公式 homebrew-cask 掲載や Developer-ID 署名 +
ノータライズ）経路は、$99 の Apple Developer プログラムが必要なため現状は deferred です。
当面は上記の cask もしくは右クリック/`xattr` で対応してください。
:::

---

## ソースからの開発起動

配布版ではなく、ソースコードからビルド・起動する場合の手順です。**通常のご利用では不要**で、
開発・改造・最新の未リリース機能を試したいとき向けです。

### 前提条件

| 要件 | バージョン | 用途 |
|---|---|---|
| Node.js | 20 以上 | フロントエンド（Vite / React / TypeScript） |
| Rust | 1.70 以上 | Tauri デスクトップシェルのビルド |

Linux では追加のシステムライブラリが必要です。

```bash
# Debian / Ubuntu 系
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev libssl-dev patchelf
```

### 取得とセットアップ

```bash
git clone git@github.com:zyuuryuu/slidecraft.git
cd slidecraft
npm install
```

### 開発サーバの起動

```bash
npm run dev          # Vite dev server（ブラウザ: http://localhost:5173）
npm run tauri dev    # Tauri + Vite を同時起動（デスクトップウィンドウ）
```

`npm run dev` はブラウザで開くデモ／開発用、`npm run tauri dev` がデスクトップアプリとしての起動です。
テンプレートの永続保存や内蔵オフライン AI などデスクトップ固有の機能は `tauri dev` 側で動きます。

### インストーラのビルド

自分の環境向けにインストーラ（`.msi` / `.dmg` / `.AppImage` / `.deb` / `.rpm`）を生成する場合。

```bash
npm run build        # フロントエンドをビルド（tsc + vite）
npm run tauri build  # 実行中の OS 向けインストーラを生成
```

::: tip 動作確認
起動後に AI 機能を使う場合は [AI設定](/guide/ai-setup) を、AI エージェント（Claude Desktop / Claude Code 等）
から SlideCraft を駆動する場合は [MCP](/guide/mcp) を参照してください。
:::

---

## 次のステップ

- はじめてのスライドを作る → [Markdown 記法](/guide/markdown-authoring)
- 会社テンプレートを取り込む → [テンプレート](/guide/templates)
- 図を描く → [図](/guide/diagrams)
- 起動やインストールで困ったとき → [FAQ](/guide/faq)
