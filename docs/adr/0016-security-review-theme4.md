# ADR-0016: セキュリティレビュー（テーマ4）— 配布/自動化前提の全面監査と是正方針

- **Status**: Accepted（**監査完了 2026-07-04**・是正はコード未実装＝ROADMAP バックログ／[ADR-0010](0010-security-model.md) を **supersede せず補追**）
- **Date**: 2026-07-04

## Context

ROADMAP テーマ4「セキュリティレビュー」（サイズ M〜L）。土台は [ADR-0010](0010-security-model.md)（token 境界・loopback・no-fs/scoped-fs・zip 硬化）。配布（Tauri デスクトップ）＋自動化（MCP 経由で上流 AI がデッキを編集）を前提に、攻撃面を **5 サーフェス並列 read-only 監査**（実コードを `file:line` で追跡・敵対シナリオ付き・確証度ラベル付き）で全面点検した：

1. **MCP＋協働ホスト**（token/scope/egress）
2. **BYOK シークレット＋AI egress**
3. **Tauri backend**（子プロセス spawn・モデル自動DL整合性・fs/http capability 幅）
4. **供給網＋CI/CD**（`npm audit`・Action ピン止め・リリース署名・SBOM/dependabot）
5. **XSS＋untrusted 入力**（SVG/Markdown injection・zip-slip/DoS・prototype 汚染）

信頼境界は **OS ユーザ**（同一ユーザ権限のマルウェアはスコープ外＝ADR-0010 踏襲）。ただし **remote-content 由来の XSS→キー窃取**・**custom baseURL によるキー流出**は同一ユーザ malware を要しない＝スコープ内として扱う。

### 監査で成立を確認した中核（ADR-0010 の主張は保持）

- **MCP token 境界**：`checkRequest` が全リクエスト経路の先頭で、`safeEqual`（`crypto.timingSafeEqual`・長さ不一致でも early-return しない）による 256bit per-launch token 照合。pre-auth で到達可能なエンドポイント無し。Origin は belt（順に Host-loopback 421 → present-Origin allowlist 403 → token 401）で、絶対 Origin は token を代替しない。bind は厳密に `127.0.0.1`（ephemeral port・`0.0.0.0` 皆無）。`x-slidecraft-role` は advisory（token 後に読む・spoof 不可）。（`src/mcp/host.ts`, `host-security.ts`, `host-json.ts`）
- **MCP ツール面の fs/shell 不在**：全ツールは base64 bytes / in-memory 文字列を取り、`create_template` はファイルを書かず base64 返却。`read_file`/`write_file` は**ツール非公開**。`--root` は `exit 2` で拒否・既定 `--no-fs`。path traversal 到達路無し。
- **子プロセス spawn（llamafile / node collab）**：`Command::new(bin)` ＋ **per-arg `.arg()`**・shell 不使用・webview 由来 arg 無し・loopback bind。injection 無し。（`src-tauri/src/local_ai.rs`, `collab.rs`）
- **モデル自動DL整合性**：pinned `WEIGHTS_SHA256` を stream 検証 → **一致時のみ atomic rename**（rename/実行の前に検証）・不一致は `.part` 削除。TLS は pure-rustls・検証 on・`danger_accept_invalid_certs` 皆無。DL 先ファイル名は compile-time 定数＝traversal 無し。（`local_ai.rs`）
- **zip 硬化**：入力 bytes（100MB）＋entry 数（5000）を展開前に検査・per-entry stream 展開で上限超過の瞬間に中断・deck.json は zod 検証・スライド数 ≤2000。（`src/engine/zip-safe.ts`, `project-io.ts`）
- **prototype 汚染は不発**（実測）：zod のオブジェクト構築が `__proto__` を own-key として落とすため `DiagramSpecSchema.parse`／`z.record` 経路で `Object.prototype` 汚染せず。js-yaml v4 の既定 `load` は `!!js/function` を**拒否**（実行確認）＝**dependabot PR #13 はセキュリティ的に非緊急**。
- **供給網の健全部**：全 GitHub Action は **SHA ピン止め**・`claude-review.yml` は `pull_request`（危険な `pull_request_target` でない）で fork PR に secrets 非露出・lockfile 両方コミット済・`npm ci` 使用・dependabot は npm/cargo/actions 3 系統。
- **XSS 封じ込め（アプリ内）**：本番/dev CSP とも `script-src 'self'`（`'unsafe-inline'` 無し）＝インラインハンドラ/`javascript:` を webview 内で無効化。ネイティブ図 SVG（`svg-writer.ts` の `esc()`/`col()`）と Markdown（React 子要素で自動エスケープ）は安全経路。

## Decision

監査で **1 系統の egress 穴（4/5 エージェントが独立指摘）** と **HTML エクスポート経路の XSS carrier** を検出。ユーザ合意（2026-07-04）は **①custom endpoint は opt-in で維持しつつ既定 egress を絞る／②本 ADR ではレポート＋記録に留め、コード是正は ROADMAP バックログ**。以下を「決定した是正方針」として確定し、実装は追跡項目とする。

### F1〔HIGH〕webview egress の実ゲートが CSP でなく緩い `http:default` だった → **既定を絞り、custom は opt-in**

`appFetch` は desktop で `@tauri-apps/plugin-http`（Rust）経由＝**webview CSP `connect-src` を迂回**する。CSP は3社+loopback に絞ってあるが、実ゲートである `http:default` capability が `{"url":"https://**"}`＝全 HTTPS 開放（`src-tauri/capabilities/default.json`）。加えて `baseURL` は無検証（`src/ipc/openai-compat.ts` / `ai.ts`）で、攻撃者 proxy を指させれば BYOK キーが `Authorization: Bearer` で流出（F1 と連鎖）。ADR-0010 は「connect-src は ipc・Ollama・指定 AI API のみ許可」と記すが、**plugin-http scope がそれを黙って広げていた**（実ゲート≠CSP）。

**是正方針**（ユーザ選択 2026-07-04＝**右サイズ実装済**／hard boundary は保留）：F2 で主要 XSS carrier（`svgCache`）が塞がった結果、capability 縮小（＝XSS→plugin-http→任意ホスト流出の遮断）の限界価値は低下し、残る主リスクは**社会工学で悪意 baseURL に誘導される**ケースに絞られた。よって次を採る：

- **実装済（右サイズ）**：
  - `baseURL` は非 local 宛先に **https-only を強制**（`assertValidBaseURL`＝`src/ipc/ai.ts`）＝`http://`（や scheme 無し bare host）でのクラウド送信＝`Authorization: Bearer` のクリアテキスト漏洩を遮断。egress の単一チョーク（`generateWithAI`／`listProviderModels`）で検証。
  - **非プリセット cloud host への送信は明示同意**（`ensureEgressConsent`＝`src/ipc/egress-consent.ts`・`runTask` に挿入）：プリセット（Anthropic/OpenAI/OpenRouter）・ローカル/loopback/LAN は無音、それ以外の custom host は初回のみネイティブ確認ダイアログで承認 → 承認済みは `localStorage`（`slidecraft_trusted_endpoints`）に記憶。**capability は現状維持**＝UX 防御であり hard boundary ではない（受容トレードオフ）。
- **保留（別バックログ・優先度低下）**：`http:default` の `https://**` を CSP 一致 allowlist（3 AI API＋`huggingface.co`＋`cdn-lfs*.huggingface.co`〔モデルDL の LFS CDN 302 先・含めないと DL が壊れる〕＋loopback）に縮小し、承認済み custom host を Rust 側 egress ゲート（reqwest・host allowlist 強制）で通す**実境界**化。streaming fetch の Rust 越し再実装を要するため大きめ＝F2 で XSS 前提が縮小した今は後続。

### F2〔HIGH〕`svgCache` 経由の stored XSS ＋ エクスポート HTML の CSP 欠落

永続化された `mermaidBlock.svgCache`（untrusted `deck.json` 文字列＝`src/engine/slide-schema.ts:89` の `z.string().optional()`）が `mermaid.render()`（`securityLevel:"strict"`）を**経ずに** `dangerouslySetInnerHTML` へ直行する fast-path（`src/components/SlidePreview.tsx:68`）。アプリ内は CSP で封じ込め済だが、**エクスポート HTML には CSP `<meta>` が無く**（`src/engine/html-shell.ts`・`deck-html-export.tsx:42` が svgCache を inline）、書き出した `.html` を共有先が開くと payload が発火＝**self-XSS-to-others**。キーは localStorage 平文のため XSS＝キー窃取に増幅。

**是正方針**：
- **root-cause**：永続 `svgCache` を**信頼しない**。`openProject` で全 `mermaidBlock.svgCache` を破棄し、描画時に再計算（cache であって source-of-truth でない）。
- エクスポート shell（`html-shell.ts`）に制限的 CSP `<meta http-equiv>` を付与（インライン nav script は nonce/hash 化）。
- `SlideCard` の SVG sink を DOMPurify で sanitize（SSR 単位でもあるため export も同時に守る）。

### F3〔MEDIUM〕BYOK キーが localStorage 平文

`src/components/useAiGeneration.ts:325`（`rememberKey` 時）。at-rest の同一ユーザ可読は信頼モデル上**受容**だが、XSS→キー窃取の増幅路を成す。OS keychain 選択肢はコード上に皆無。

**是正方針（実装済・best-effort keychain）**：API キーを含む AI config を **OS keychain**（Windows Credential Manager / macOS Keychain / Linux Secret Service＝Rust `keyring` crate ＋ `secret_set/get/delete` commands・`src-tauri/src/secret_store.rs`）へ保存し、**localStorage の平文バケットと自明な `localStorage.getItem` XSS-read を排除**。keychain backend が無い環境（browser/demo・Secret Service 不在の Linux/WSL）は **localStorage へフォールバック**＝現状維持・無回帰、keychain のある環境では厳密なアップグレード（`src/ipc/key-store.ts`）。旧 localStorage blob は初回ロードで keychain へ移行。**限界**：SDK は JS でリクエストを組むため、キーは使用中 JS ヒープに載る＝webview 侵害からの完全な切り離しは **Rust egress proxy（F1'）**が必要（keychain は at-rest のみ解決）。**実 keychain 往復は開発機（WSL・Secret Service 無）で未実行＝Windows/macOS で要確認**（`cargo check` green・JS 層は mock でユニット済）。

### F4〔LOW／運用〕供給網・その他

- **[実装済]** `stage-node.mjs` の SHA256 チェック欠落 → nodejs.org の SHASUMS を **6 ターゲット分ピン止め**し展開前に検証（`stage-llamafile.mjs` 準拠・fails closed）。
- **[実装済]** `esc()`（`src/engine/svg-writer.ts`）が `'` を未エスケープ → `&#39;` を追加（現状到達不能だが将来の単一引用符属性への latent 硬化）。
- **[N/A]** fs capability の `allow-remove`/`allow-mkdir` は **webview が使用中**（`src/ipc/master-store.ts` のマスター登録＝import/remove、`$APPLOCALDATA/masters` スコープ内）＝削減不可。スコープは masters/ に限定済みで問題なし。
- **CI 停止中**（Actions 課金ブロック・[[ci_actions_billing]]）＝`security.yml`（npm/cargo audit）・`sbom.yml`・`ci.yml` が未実行＝監査/SBOM/テストゲートが効いていない。かつ両 audit job は `continue-on-error: true`＝再有効化後も informational。再有効化時に **high 以上を required 化**。
- **npm high 7 件**（全て breaking major）：`vite`/`esbuild` は dev-only（shipped bundle 非該当）・**`mermaid`→`chevrotain`→`lodash-es` のみ runtime 到達**＝優先。
- **Homebrew cask の placeholder sha256** は設計どおり（`update-cask.mjs` が per-release で実 hash 埋め・`:no_check` へ退避しないこと）。
- **Tauri updater は未設定**（現状リスク無し）＝将来 auto-update 追加時は **署名＋pubkey ピン止め必須**。

## Consequences

**良い点**
- 配布/自動化を前提にした攻撃面を全面点検し、**ADR-0010 の中核ガードが実挙動として成立**することを実コード追跡で確証。最大の穴（実 egress ゲートが CSP でなく `https://**`）と XSS carrier（`svgCache`→エクスポート HTML）を特定し、是正方針を確定。
- custom endpoint を opt-in に移すことで、**既定攻撃面（blanket https 開放）を閉じつつ BYOK の柔軟性を保つ**。

**do-NOT-undo ガードレール（[ADR-0010](0010-security-model.md) を継承＋追加）**
- 継承：任意パス `read_file`/`write_file` を再導入しない・`csp:null` に戻さない・リスナ bind を `0.0.0.0` にしない・token 照合を timing-safe から外さない・Origin allowlist を token の代替にしない・zip 上限を緩めない。
- 追加：`http:default` を再び `https://**` に**広げない**（実ゲートは plugin-http scope＝CSP と一致させる）。永続 `svgCache` を**信頼しない**（open 時に破棄/再計算）・`dangerouslySetInnerHTML` に到達する SVG は sanitize 前提。エクスポート HTML から CSP を外さない。モデルDL/staging の SHA256 検証を外さない。

**代償・限界（是正は未実装＝バックログ）**
- ユーザ選択（レポート＋ADR のみ）により、F1〜F4 の**コード修正は本 ADR では未実施**。ROADMAP バックログに追跡項目として起票し、後続セッションで test-first（R3）で実装する。
- **ADR-0010 の記述ドリフト**：ADR-0010 の「connect-src は…のみ許可」は CSP としては真だが plugin-http capability が広い、という不整合を本 ADR が記録（ADR-0010 は immutable のため書き換えず・本 ADR で補追）。F1 実装時に capability を CSP と一致させることで解消する。
- CI 再有効化は課金ブロック依存（[[ci_actions_billing]]）。それまで `npm audit --audit-level=high` ＋ `cargo audit` をリリース前手動ゲートとする。

## Addendum（2026-07-07・M6 リリース前セキュリティ再チェック — 新サーフェス是正）

初回リリース（v0.1.0）準備の M6 として、ADR-0016 以降に追加された新サーフェス（画像埋め込み ADR-0020・
MCP テンプレ選択 ADR-0015 S2 増分2・テンプレ作成カスタムレイアウト）をリリース準備監査で再点検し、実バグを是正した。

**是正済み（M6）:**
- **画像 `src` の未検証 XSS 経路**：`ImageBlockSchema.src` が `z.string()` だったため、Markdown import / MCP テキスト
  変更経由で `javascript:` / remote / `file:` / `data:text/html` が `<img src>`（`SlidePreview.tsx`）と export HTML に
  永続化し得た（stored XSS）。**二層防御**で是正：`isSafeImageSrc`（`data:image/` allowlist＋サイズ上限）を
  (1) `ImageBlockSchema.src` の zod refine（never-silent backstop）と (2) `md-slide-parser.matchImageLine`（unsafe src は
  drop＝行はテキストに degrade）に適用。相対/リモート src は画像化しない挙動に変更（export は CSP `img-src data: blob:` で
  どのみち不可＝機能損失なし）。`tests/image-src-security.test.ts`。
- **画像 data-URI の DoS**：`MAX_IMAGE_DATA_URI`（16 MB）で per-image 上限を追加（`isSafeImageSrc` 内）。
- **export HTML の CSP 常時付与**：`assembleHtmlDeck` は nonce opt-in（engine 純度・R2）だが、唯一の export 経路
  `renderDeckToHtml` は常に `makeNonce()` を渡す。これを回帰ゲート化（`tests/html-export-integration.test.tsx`＝
  export は常に `default-src 'none'`＋`script-src 'nonce-…'`）。

**推奨だが今回見送り（低リスク・token 境界内）:**
- `register_templates`（host・gui ロール限定・loopback＋bearer token）の store 時バイト上限：defense-in-depth として将来追加。
- **F1'（egress hard boundary）**：F2 で前提縮小済み・ROADMAP 保留のまま（M6 では非対象）。

## References

- 監査対象コード: `src-tauri/capabilities/default.json`・`src-tauri/tauri.conf.json`・`src/ipc/{app-fetch,ai,openai-compat,claude}.ts`・`src/components/{useAiGeneration,SlidePreview,deck-html-export}.tsx`・`src/engine/{html-shell,svg-writer,slide-schema,zip-safe,project-io}.ts`・`src/mcp/{host,host-security,host-json}.ts`・`src-tauri/src/{local_ai,collab}.rs`・`scripts/{stage-node,stage-llamafile}.mjs`・`.github/workflows/*`・`.github/dependabot.yml`
- 関連 ADR: [ADR-0010](0010-security-model.md)（セキュリティモデル＝土台・本 ADR が補追）・[ADR-0006](0006-ai-integration-architecture.md)（AI 統合）・[ADR-0009](0009-p2-collab-host.md)（協働ホスト）
- 開発メモリ: `security_present_holes`（本監査で更新）・`ci_actions_billing`・`ai_integration_architecture`
