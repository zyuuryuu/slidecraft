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

## リリースごとの更新（自動・Issue #288）

1. タグを push → `release.yml` が各 OS のインストーラを **draft release** に添付
   （macOS は ad-hoc 署名済み `_aarch64.dmg` のみ）。
2. draft を人が publish する。
3. publish をきっかけに `.github/workflows/cask-mirror.yml`（Cask Mirror）が走り、次を順に行う:
   1. `scripts/update-cask.mjs <version>` — 公開済み dmg を落として正典 cask
      （このディレクトリの `Casks/slidecraft.rb`）の `version` と `sha256` を書き換える。
   2. `scripts/verify-cask.mjs` — 書き換えた cask を公開済み `SHA256SUMS` と照合する。**不一致なら
      ジョブを失敗させ、どこにも push しない**（壊れた cask はミラーしない）。
   3. `scripts/mirror-cask.mjs` — tap リポ `zyuuryuu/homebrew-slidecraft` を clone し、
      `Casks/slidecraft.rb` を正典と同じ内容に書いて commit・push する。tap 側より古い版への
      ダウングレードは拒否する。**secret `HOMEBREW_TAP_TOKEN` が無いときはこの手順だけ警告付きで
      skip し、ジョブは緑のまま**（Summary と警告に理由が出る）。
   4. 正典 cask の変更を `cask/v<version>` ブランチに push し、main 宛ての PR を開く
      （main は保護されているので直接 push はしない）。変更が無ければ PR は作らない。
4. 開かれた PR をレビューしてマージする（下の「既知の制約」参照）。

手動で再実行したいとき（secret を後から設定した等）は、Actions → Cask Mirror → Run workflow で
`version`（例 `0.5.0`、`v` なし）を指定する。

tap への反映内容だけを確認したいときは dry-run（ファイルを書かない）:

```bash
node scripts/mirror-cask.mjs path/to/homebrew-slidecraft --dry-run
```

### 設定が必要な secret と権限

| 設定 | 値 |
| --- | --- |
| secret 名 | **`HOMEBREW_TAP_TOKEN`**（`zyuuryuu/slidecraft` の Settings → Secrets and variables → Actions → Repository secrets） |
| 中身 | **fine-grained personal access token** |
| Repository access | *Only select repositories* → **`zyuuryuu/homebrew-slidecraft` のみ** |
| Permissions | Repository permissions → **Contents: Read and write**（Metadata: Read は自動で付く）。他は不要 |
| 有効期限 | PAT は期限切れになる。切れると tap への push が失敗して Cask Mirror が赤になるので、更新して再実行する |

あわせて `zyuuryuu/slidecraft` の Settings → Actions → General → Workflow permissions で
**「Allow GitHub Actions to create and approve pull requests」を有効**にする（正典 cask の PR を
`GITHUB_TOKEN` で開くため。無効だと PR 作成の手順で失敗する。その時点で tap への push は済んでいる）。

### 既知の制約

- 正典 cask の PR は workflow の `GITHUB_TOKEN` で開かれる。GitHub の仕様で、`GITHUB_TOKEN` が起こした
  イベントでは他の workflow が起動しないため、この PR では必須チェック `test` と Verify Cask が
  **自動では走らない**。人のアカウントでブランチに push する（例: 最新 main を merge する）と走る。

### 手動での更新（フォールバック）

```bash
node scripts/update-cask.mjs <version>
# ローカルの .dmg を使う場合（publish 前の draft から落とした dmg など）:
# node scripts/update-cask.mjs 0.2.0 path/to/SlideCraft_0.2.0_aarch64.dmg
node scripts/verify-cask.mjs               # 公開後のみ有効
node scripts/mirror-cask.mjs path/to/homebrew-slidecraft   # tap の clone に書き込む → commit / push
```

## 将来: ノータライズ経路（$99 Apple Developer）

直接 .dmg ダウンロードを quarantine 剥がしなしで開けるようにしたい／公式 homebrew-cask に載せたい場合のみ
必要。その際は `tauri.bundle.conf.json` の `macOS` を Developer-ID 署名 + `hardenedRuntime: true` に切替え、
llamafile の JIT 用に entitlements（`com.apple.security.cs.allow-jit` +
`com.apple.security.cs.allow-unsigned-executable-memory`）を追加し、release.yml でノータライズを実行します。
現状は Windows/Linux 優先のため deferred。
