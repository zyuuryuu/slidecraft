# macOS 配布 — Homebrew tap（ad-hoc 署名 + cask）

SlideCraft の macOS ビルドは **ad-hoc 署名（`codesign -s -`）**され、**ノータライズはしない**方針です
（Apple Developer $99/年 を要しない）。配布は独自の Homebrew tap 経由の cask で行います。

## なぜ cask か

- `brew install --cask` はインストール時に `com.apple.quarantine` xattr を剥がすため、Gatekeeper の
  「開発元を確認できません」ブロックが発生せず、ad-hoc 署名だけでもクリーンに起動します。
- 独自 tap（`zyuuryuu/homebrew-slidecraft`）は**公式 homebrew-cask と違いノータライズ必須ではありません**。
- Apple Silicon は「未署名バイナリを一切実行できない」ため、ad-hoc 署名は**必須**（$0）。同梱の
  `node` / `llamafile` は別プロセスとして spawn されるので、release.yml でそれぞれ個別に ad-hoc 署名しています。

> 直接 .dmg をダウンロードした場合は quarantine が残るため、初回のみ右クリック →「開く」、または
> `xattr -dr com.apple.quarantine /Applications/SlideCraft.app` が必要です。brew 経由なら不要。

## tap リポジトリの初期セットアップ（1 回だけ）

Homebrew の tap はリポジトリ名が `homebrew-<name>` である必要があります。

```bash
gh repo create zyuuryuu/homebrew-slidecraft --public \
  --description "Homebrew tap for SlideCraft"
git clone https://github.com/zyuuryuu/homebrew-slidecraft
mkdir -p homebrew-slidecraft/Casks
cp packaging/homebrew/Casks/slidecraft.rb homebrew-slidecraft/Casks/
(cd homebrew-slidecraft && git add Casks/slidecraft.rb && git commit -m "Add slidecraft cask" && git push)
```

利用者側:

```bash
brew tap zyuuryuu/slidecraft
brew install --cask slidecraft
# もしくは一発で
brew install --cask zyuuryuu/slidecraft/slidecraft
```

## リリースごとの更新手順

1. タグを push → `release.yml` が各 OS のインストーラを **draft release** に添付
   （macOS は ad-hoc 署名済み `.dmg` が 2 つ: `_aarch64.dmg` / `_x64.dmg`）。
2. draft を publish（または publish 前でもアセットは取得可）。
3. cask のバージョンと両アーキの sha256 を更新:

   ```bash
   node scripts/update-cask.mjs <version>
   # 例: node scripts/update-cask.mjs 0.2.0
   # ローカルの .dmg を使う場合:
   # node scripts/update-cask.mjs 0.2.0 path/to/SlideCraft_0.2.0_aarch64.dmg path/to/SlideCraft_0.2.0_x64.dmg
   ```

4. 更新された `Casks/slidecraft.rb` を tap リポジトリにコピーしてコミット。

## 将来: ノータライズ経路（$99 Apple Developer）

直接 .dmg ダウンロードを quarantine 剥がしなしで開けるようにしたい／公式 homebrew-cask に載せたい場合のみ
必要。その際は `tauri.bundle.conf.json` の `macOS` を Developer-ID 署名 + `hardenedRuntime: true` に切替え、
llamafile の JIT 用に entitlements（`com.apple.security.cs.allow-jit` +
`com.apple.security.cs.allow-unsigned-executable-memory`）を追加し、release.yml でノータライズを実行します。
現状は Windows/Linux 優先のため deferred。
