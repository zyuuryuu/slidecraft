# リリース手順（Releasing）

## バージョニング方針（Semantic Versioning）

- `MAJOR.MINOR.PATCH`。**0.x 系は「早期版」** — MINOR でも破壊的変更（API・`.slidecraft` ファイル形式・テンプレ契約）があり得る。安定を約束する段階で `1.0.0` に上げる。
- **版数の単一ソースは [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json)**（インストーラ metadata を駆動する de-facto canonical）。他の6箇所 — `package.json`・`src-tauri/Cargo.toml`・`src/mcp/server.ts`・`src/ipc/collab-client.ts`・`src/ipc/app-version.ts`・`packaging/homebrew/Casks/slidecraft.rb` — は [`scripts/bump-version.mjs`](scripts/bump-version.mjs) で自動同期し、`npm test`（[`tests/version-sync.test.ts`](tests/version-sync.test.ts)）が drift を検出する。
- 手で個別のファイルを書き換えない。必ず bump スクリプト経由にする。

## 手順

1. **バージョンを決めて伝播**（例 0.2.0）: `npm run version:set 0.2.0`（7ファイルへ反映）。`npm run version:check` で一致を確認。
2. **CHANGELOG.md を更新**: `## [Unreleased]` の内容を `## [0.2.0] - YYYY-MM-DD` に移し、新しい空の Unreleased を作る。**このセクションがそのままリリースノートになる**（`release.yml` がタグの版に一致する `## [x.y.z]` 見出しを抽出して `releaseBody` に使う。無いと release ジョブが失敗する — never-silent）。
3. **ローカル検証**: `npm test`・`npm run build`・`npm run typecheck:mcp` が全緑。
4. **コミット & タグ**: `chore(release): v0.2.0` → `git tag v0.2.0 && git push origin main --tags`。→ `release.yml` が **3-OS**（macOS arm64・Windows・Linux。Intel Mac インストーラは廃止済み — [#112](https://github.com/zyuuryuu/slidecraft/issues/112)）installer をビルドして **draft** リリースを作成する。続けて `SHA256SUMS`・SBOM（npm＋cargo、CycloneDX）をリリースアセットとして添付し、各インストーラに `actions/attest-build-provenance` で build provenance attestation を付与する（署名の代わりの完全性シグナル — 署名自体は導入しない）。

   > **タグ push は push 権のある環境（メンテナの手元）で行う。** リリースの起点は `v*` タグ push（`release.yml` の `on: push: tags`）。Claude Code の管制セッション（GitHub App 連携）は **`refs/tags/*` の push も `workflow_dispatch` の起動も 403**（App に該当 write 権が無い）なので、**タグ push は人間が実行**する。将来 workflow_dispatch を実リリース経路に昇格する案（#290 (b)）は、セッションから叩けない以上メリットが薄く見送り。App に `actions: write` を付与できるようになったら再検討。
5. **成果物レビュー（実機）**: draft の installer を Windows / macOS 実機で起動確認（M9）。macOS は ad-hoc 署名 `.dmg` が `killed:9` せず開くこと・keychain 往復・モデル自動DL を確認。
6. **Homebrew cask 更新**: cask（[`packaging/homebrew/Casks/slidecraft.rb`](packaging/homebrew/Casks/slidecraft.rb)）の `sha256` を新しい arm64 `.dmg` の値へ更新する。sha256 の取得は3通り:
   - **`SHA256SUMS` アセットの `…_aarch64.dmg` 行の値をそのまま使う**（最も簡単・`checksums` ジョブが生成した正典。GitHub の Assets 一覧に出る各資産の `sha256:` も同値）。手で `sha256 "…"` を差し替えるだけ。
   - `node scripts/update-cask.mjs <version> <path-to-aarch64.dmg>` に **draft から落とした .dmg のローカルパス**を渡す（**publish 前でも**計算できる）。
   - `node scripts/update-cask.mjs <version>`（引数無し）は**公開 URL から自動 DL**するので **publish 後**のみ有効（draft のうちは 404）。
   > 引数無しを publish 前に叩くと 404 になる。draft の .dmg のバイト列は publish 後と同一なので、上の 1・2 で先に確定してよい。更新後は tap リポ `zyuuryuu/homebrew-slidecraft` にも反映（[#288](https://github.com/zyuuryuu/slidecraft/issues/288) で自動化予定）。
7. **publish**: draft を publish。自動更新（軽量通知）が新版を検知できる状態にする。

## 自動更新について

初回リリースでは **完全な署名付き Tauri Updater を導入しない**。理由＝アップデート署名鍵は一度配布すると**回転不可**（既存クライアントが孤立する不可逆判断）。v0.1.0 は GitHub Releases API のポーリングで「新版あり」を**通知するだけ**とし（ROADMAP M12）、mac は `brew upgrade`、Windows/Linux は手動再DL で更新する。完全版 Updater は出荷後に別途 ADR で判断する（ROADMAP バックログ）。
