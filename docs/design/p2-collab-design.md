# P2 設計：GUI ホスト型 AI×人間 協働

> 設計 workflow（4提案→採点→統合→敵対レビュー, confidence: high）の成果。
> 敵対レビューが見つけた5つの穴を織り込んだ「修正版」。

## ビジョン（北極星 / [[collab_host_model]]）
- **人間が GUI を起動 → MCP エンドポイントが自動起動。GUI がホスト。**
- 上流 AI は**接続してくる**（stdio 子を spawn しない）。同じ MCP **Tools(18)** で駆動。
- AI の編集が **GUI にライブ反映** → 人間が観察＋直接編集。
- 人間→AI フィードバックは**スコープ外**（人間のチャットで行う）。
- 正＝AI→PPTX（headless）。協働は「一番いい」上乗せ。

---

## アーキ決定：真実は **Node サイドカー**（GUI は対等な MCP クライアント）

中心の分岐＝「deck の真実はどこに住むか」を **truth-in-host-process（Node サイドカー）** で決着。
truth-in-webview（listener が全 tool 呼び出しを Tauri IPC で webview にトンネル＋Rust で Origin 検証を再実装＝穴）と、二重コピー方式（divergence 再発）を退ける。

```
 ┌──────────────┐   MCP/HTTP(loopback)+token   ┌────────────────────────────┐
 │ 上流 AI       │ ───────────────────────────▶ │ Node サイドカー (host.ts)   │
 │(Claude等・客) │ ◀─── deckChanged 通知 ─────── │  唯一の Session(session.ts) │
 └──────────────┘                               │  buildServer(18 tools)      │
                                                │  ＝唯一の真実               │
 ┌──────────────┐   MCP/HTTP(loopback)+token    └──────▲─────────────────────┘
 │ React webview │ ──── tool 呼び出し（人間編集）──────┘
 │ (GUI/人間)    │ ◀─── deckChanged → setDeck('commit') 描画（projection）
 └──────────────┘
        ▲ Tauri Rust：サイドカーを spawn/監視/reap・{url,token}を webview に IPC で渡すだけ
          （DeckIR には一切触れない＝scoped-fs の穴は閉じたまま）
```

**要点**：webview も AI も**同じサイドカー Session の対等なクライアント**。webview は rev 付きの**射影**であって競合コピーではない。人間の GUI 編集も `set_slide_markdown` tool 呼び出しとしてサイドカーに往復＝**タイムラインは1本・真実は1つ**。

### 1回の tool 呼び出し（end-to-end）
1. AI が `POST /mcp`（`Authorization: Bearer <token>`）で `set_slide_markdown{index,markdown}`
2. 自前ミドルウェア：token 定数時間比較＋Origin 許可リスト検証
3. SDK StreamableHTTP → 登録ハンドラ → `S.applySlideMarkdown(session,i,md)`（**stdio と同一の純エンジン**）
4. 該当ハンドラで **rev++（同期・deck 入替と原子的）** ＋ `deckChanged{rev,docId,changedSlides,opId}` を SSE で全クライアントへ
5. AI には ToolResult が返る／webview は通知を受け `get_slide_markdown(changedSlides)` を引いて `setDeck(next,'commit')`＝**1手の undo 可能ステップ**として再描画
6. Rust は DeckIR に触れていない

---

## 敵対レビューで修正した5点（ここが重要）

### ① セキュリティの機構が当初記述は誤り → 正しい形に
- **socket 既定は不可**：webview の fetch も url-transport の AI も AF_UNIX を dial できない。→ **loopback HTTP を真の既定**、socket はニッチな opt-in に降格。
- SDK の `createMcpExpressApp` は **Host ヘッダ検証のみで Origin 検証はしない**（当初の「SDK が Origin を弾く」は誤り）。実際の防御は:
  - **(a) per-launch 256bit bearer token**＝自前ミドルウェア（`crypto.timingSafeEqual`。SDK の `requireBearerAuth` は OAuth 形で流用不可）。**これが書き込みの実トラスト境界**。
  - **(b) 自前 Origin 許可リスト**（`tauri://localhost` / `http://localhost:5173` のみ）。
  - **(c)** transport が `Content-Type: application/json`＋`Accept: text/event-stream` を要求 → クロスオリジン POST は非単純 CORS → ブラウザタブは結果を読めない。
  - **(d)** `127.0.0.1` 限定 bind（`0.0.0.0` 不可）。
- **非目標を明示**：同一 OS ユーザのマルウェア（0600 token 読取）は守らない。OS ユーザ＝トラスト境界（stdio と同じ）。

### ② 同時編集の順序（lost-update）→ v1 はシンプル版
- 人間のキー入力は **ローカルに留める**（coalesce）。**blur/commit 時だけ** `set_slide_markdown` を `expectedRev` ガード付きで送る（stale なら 409→再 pull、never-silent）。これで「共有 doc でタイプ中にカーソルが飛ぶ」古典バグを回避。
- echo 抑制：送信編集に client 生成 `opId` → サイドカーが `deckChanged` で反響 → 自分発の frame は適用しない。

### ③ rev 更新は **mutating ハンドラのみ**（run() ではない）
- `run()` は read もラップするので、そこに hook すると `get_deck` ごとに `deckChanged` が飛ぶ。→ **~8個の mutating ハンドラに限定**（applySlideMarkdown / applyDeckMarkdown / distill / visualizeKeyValue / setDiagram / applyDesignIntent / openProjectBytes / newProject）。rev は **deck 入替と同期**（async ハンドラの await 跨ぎで interleave しないようサイドカーで apply キュー直列化）。

### ④ new_project のスコープ矛盾 → 要決定（下記）
単一 Session に `new_project` すると共有 deck を**破壊**する（新タブを開くには禁じたサーバ→クライアント命令が要る）。v1 は「共有 session では `new_project`/`open_project` を禁止」か「最初から one-session-per-docId」の二択。

### ⑤ 配布：サイドカーは **OS 別の実行可能バイナリ**が必要
`build:mcp` は `--packages=external`＝非自己完結。host は **node-sea/pkg で単一実行ファイル化**（or node 同梱）して `bundle.externalBin` に登録。express＋MCP SDK＋engine(pptxgenjs/jszip/mermaid は parse-only)を DOM 依存を引かずに bundle できるか検証。**ここが L サイズの地味な山**。

---

## dual-mode（built は無駄にならない）
- `cli.ts`（stdio・--no-fs・正の素体）＝**無変更**。listener なし。
- `host.ts`＝同じ `createSession`+`buildServer` に第2トランスポート＋broadcast bus を足すだけ。
- engine 側の唯一の変更＝`buildServer` に任意 `onMutate?(session)`（stdio では undefined＝no-op）＋ host モードでは `registerResources` を opt-out（resources は本ビジョンで孤児）。

---

## 段階プラン（出荷可能な増分）
- **P2.0 シーム**（Tauri 無し・stdio 無影響）：mutating ハンドラに `onMutate`/rev、`registerResources` を opt-out 化。「read で deckChanged が飛ばない」回帰テスト。
- **P2.1 host.ts**（GUI 無しで検証可）：HTTP＋token＋Origin＋broadcast。`build:host` で自己完結 bundle。MCP クライアントで loopback 越しに tool＋通知＋token/Origin 拒否を検証。
- **P2.2 Tauri サイドカー lifecycle**：`tauri-plugin-shell`＋`bundle.externalBin`、spawn/監視/reap、{url,token} を IPC、3 OS で起動・reap 確認（配布の山）。
- **P2.3 webview＝MCP クライアント＋ライブ描画**：`deckChanged`→pull→`setDeck('commit')`、Connect パネル（URL+token＋`claude mcp add` スニペット）、CSP に `http://127.0.0.1:*`（固定ポート推奨）。
- **P2.4 人間編集の往復＋並行性**：共有 doc の編集を tool 呼び出しで往復（echo 抑制）、`expectedRev` ガード、「AI がスライド N を編集中」presence、single-client-claim。
- **P2.5 ハードニング**（＋socket opt-in）：token ローテーション、host.json の rebind 時無効化＋SIGTERM クリア＋Windows ACL、Origin 拒否テスト。
- **P2.6（任意・前方）**：one-session-per-docId（`select_document`/`list_documents`）。CRDT は実需要が出るまで延期。

---

## あなたに残す決定（R1 時点。R2 で 1・2 は決定済み＝下記）
1. ~~new_project~~ → **最初から multi-doc（one-session-per-docId）に決定**
2. ~~共有 doc の Undo~~ → **サーバ側 Undo を v1 で作るに決定**
3. **token 配布 UX**：URL+token を手でコピペ（単純） vs SlideCraft が AI クライアントの設定を自動書込
4. **v1 は単一共有セッション** → R2 で multi-client（webview＋AI が対等接続）に変更
5. resources は host モードで**無効化**で確定（ほぼ確定）

---

## R2 更新（multi-doc ＋ サーバ側 Undo）— コード検証済み

> R2 設計 workflow（4トラック深掘り→統合→敵対, confidence: high）。SDK 1.29・実コード行番号で検証。
> **P2.0 は着手可能**（敵対レビューの1ブロッカー＝テスト配置だけ修正すれば）。

## R2 で変わったこと（3点）
1. **multi-doc**：単一 Session → **DocRegistry `Map<docId, DocEntry>`**（host.ts に住む。session.ts は単一doc/純粋のまま、cli.ts は1エントリ registry で stdio byte-identical）。
2. **server-undo**：純 `historyReducer` を **`src/shared/history-core.ts`（React/zod非依存・R2安全）** に lift し、session/GUI/host が共有。各 DocEntry が `HState<DeckIR>` を持ち、`undo`/`redo` tool が真実を巻き戻し新 rev を発行。GUI の Undo ボタンは host モードで tool に再ルート。
3. **検証された訂正**：SDK は **1 McpServer＝1 transport**（protocol.js:793）。よって webview と AI は**別々の {server,transport} ペアで DocRegistry を共有**し、broadcast は単一 `notification()` でなく**接続クライアント全員への fan-out ループ**。

## Session モデル（2つの「session」を厳密に分離）
- **MCP-transport-session**（SDK 所有・`Mcp-Session-Id`／`extra.sessionId`）＝接続クライアント1つ（webview と AI で別）。
- **DocEntry**（我々の真実）＝開いているドキュメント1つ。`{docId, session, rev, history, applyQueue, presence, title}`。
- **doc アドレッシング**：`select_document{docId}` で**接続ごとの active-doc**（`extra.sessionId` をキー）を設定＝AI 版 switchDoc。16 の deck 操作 tool は docId 不要（active を解決）、任意の `docId` 上書きあり。`new/open_project` は host モードで**新 docId を mint**し `documentOpened` 通知。

## ツール変更（18→ +list/select/close_document, +undo/redo, +set_presence）
- 8 mutating tool に任意 `opId`/`expectedRev`/`docId`、結果に `{rev,opId,changedSlides}`。
- 通知：`deckChanged{docId,rev,prevRev,opId,changedSlides,kind,canUndo,canRedo}` / `documentOpened` / `documentClosed` / `presence`。

## 並行性プロトコル
- **per-doc apply-queue**（rev は前進のみ・undo も新 rev を発行）。doc 間は並列、doc 内は直列。
- 人間タイプは**ローカル維持→blur で1コミット送信**（`expectedRev=shownRev`、stale→409→re-pull、never-silent）。
- echo 抑制：`opId` を自分発と照合。SSE frame と HTTP 応答の競合は recentSelfOpIds LRU で吸収。

## 配布／セキュリティ
- **stock node を externalBin ＋ esbuild `host.cjs`(CJS, --packages=external なし)**（node-sea/pkg は notarization 税で却下）。mermaid は GUI 専用＝headless bundle から tree-shake 除外（`mermaid-to-diagram` は parse-only）。express を直接依存に昇格。
- **bearer token が webview の唯一の境界**（webview は Rust plugin-http 経由＝**Origin 無し**。Origin 許可リストは「存在時のみ拒否」＝dev ブラウザ向けの belt）。127.0.0.1 固定・固定ポート 5174・host.json は bind 後書込／rebind 無効化／SIGTERM 削除／Windows ACL。

## 敵対レビューが潰した穴（R2 設計に折込済み）
- **P2.0 ブロッカー**：テストは `tests/*.test.ts`（`src/**/__tests__` は vite.config の include 外＝**沈黙の false-green**）。
- **SSE GET-leg（plugin-http 経由の長寿命ストリーム）は未実証**＝最大リスク → P2.2/P2.4 でスパイク、ダメなら polling フォールバック。`documentOpened` も同 SSE 依存 → 再接続時 `list_documents` で tab 再照合（self-heal）。
- `resolveDoc` は `extra.sessionId===undefined`（stdio/in-memory）で lone/explicit doc に**フォールバック必須**。multi-doc の per-connection 検証は P2.2（実 HTTP）へ（InMemoryTransport に sessionId 無し）。
- **new/open_project は generic history-push から除外**（新 DocEntry を mint＝別 doc。古い doc 履歴に push しない）。
- **Undo は「全体の最後の1手」**（AI と人間が交互だと相手の手を undo）→ origin ラベル付きトースト「AI のスライド7編集を undo」で**非サイレント化**＋仕様明記。
- **プライバシー**：v1 は全 doc が AI 可視（人間が開いた deck も list_documents に出る）→ **要決定**（private-by-default か接続時警告か）。
- 履歴メモリ：full snapshot×200×N doc は大型 deck で 100s MB 可能 → サーバは上限を下げる/総バイト上限。
- 単一 token では presence の webview/AI 識別不可 → クライアント別 token or 自己申告 role。

## P2.0 スペック（着手可能・stdio/GUI 無変更・完全 unit test）
1. `src/shared/history-core.ts`（NEW・import 無し）に `historyReducer/HState/HAction/HISTORY_LIMIT` を**逐語 lift**。
2. `useHistoryState.ts`/`useDocumentStore.ts` を新モジュール import に**付け替え**（挙動不変）。
3. `src/mcp/server.ts`：`buildServer(session, opts?{onMutate?, registerResources?})`。`onMutate` は **8 mutating ハンドラのみ**（`run()` ではない・`{ok:false}` では発火しない）。resources opt-out。`cli.ts` は無変更＝stdio identical。
4. テスト（`tests/` 直下・R3 要承認）：history-core 純 reducer／**「read で onMutate が発火しない」回帰**（R1 穴③）／8 mutating で各1回／`{ok:false}` で非発火／無 opts で従来同一。

## 改訂フェーズ
P2.0 シーム → **P2.1 DocRegistry＋undo を InMemory で**（explicit-docId/undo/registry 隔離のみ実証） → **P2.2 host.ts transport＋security＋fan-out broadcast**（CLI client で2接続・echo抑制・SSE スパイク） → **P2.3 Tauri サイドカー lifecycle（配布の山）** → **P2.4 webview＝client＋ライブ描画＋multi-tab** → **P2.5 人間往復＋並行性＋server-undo GUI** → **P2.6 ハードニング（+socket opt-in）**。

## R2 で残る決定
- **プライバシー既定**：AI 接続中、人間が開く全 deck が AI 可視（既定共有）でよいか／private-by-default にするか／接続時警告で足りるか
- **テスト追加の承認**（R3）：`tests/history-core.test.ts` ＋ `tests/server-seam.test.ts` を追加してよいか
- 確認（既定で進められる）：固定ポート 5174／installer +50-60MB（stock node）／expectedRev は人間必須・AI 任意／schema.ts 不変（R4）／token 配布は手コピペ

---

## P2.3 / P2.4 実装ノート（branch `claude/p2-sidecar-livesync`）

実機で「AI 編集 → GUI ライブ更新」を確認済み。多エージェント敵対レビュー（18 件確認）を反映。

### 実装した形
- **P2.3（Rust）**：`src-tauri/src/collab.rs` が Node サイドカー（`dist/mcp/host.cjs`）を `std::process` で spawn・所有。`SLIDECRAFT_READY {url,token}` を stdout で受領し webview へ返す。`RunEvent::ExitRequested/Exit` で kill+wait、stop/quit 時に host.json を Rust が削除（Windows の TerminateProcess は SIGTERM クリーンアップを飛ばすため）。
- **P2.4（webview）**：`collab-projection.ts`（gui クライアント・`deckChanged`/poll(1.2s) を rev ガードで集約 → `get_deck` → `setDeck`）、`useCollab.ts`、`CollabPanel.tsx`。
- **seed**：開始時に現デッキを**正確な .slidecraft バイト**（`bundleProject` → `open_project`）で共有。初回 adopt は `'silent'` 適用＝**現在の編集物を上書きしない／undo を汚さない**。
- **ライブ更新の二段**：SSE push が plugin-http で通らなくても poll(1.2s) が確実な床。tick エラー時は polling を止め `'error'` を出し、`開始` で再接続できる（never-silent）。

### 設計からの意図的な逸脱（理由あり）
- **固定ポート 5174 → ephemeral(0)**：webview は Rust plugin-http 経由でホストに到達するため CSP はポートを gate しない（境界は bearer token）。ephemeral でポート衝突・stale サイドカー衝突を回避。`claude mcp add` スニペットは READY が返す実 URL を表示。
- **CSP / capability 変更なし**：上記の理由（plugin-http＝Origin 無し、http スコープは 127.0.0.1:* 既定許可）。

### 既知の制限（後続フェーズ）
| 項目 | 状態 | 後続 |
|---|---|---|
| **配布**：stock node を externalBin、host.cjs を resources で同梱。**release-only overlay** `src-tauri/tauri.bundle.conf.json`（`tauri dev`/`cargo check` を壊さないため base から分離）＋ **クロスプラットフォーム** `scripts/stage-node.mjs`（triple→nodejs.org dist を版固定 DL→`binaries/node-<triple>[.exe]`）。`release.yml` は per-matrix で staging＋`--config` overlay を適用（win/mac/linux で node 同梱）。collab.rs release は `current_exe()` 隣の node（mac は `Contents/MacOS/`）＋resource host.cjs（mac は `Contents/Resources/`）を解決 | Windows: 実機✅ ／ CI・mac/linux: コード済・要検証 | **mac 署名**：unsigned は Gatekeeper で同梱 node が "killed:9" の恐れ → ad-hoc 署名(無料)→Developer ID＋notarization。collab.rs は mac でもパス正（要 .app 確認） |
| **Windows ACL**：host.json は 0600（Windows では no-op）。Rust の ACL ロックダウン未実装。token は per-user プロファイル ACL ＋ per-launch ローテーションに依存 | 単一ユーザは可 | P2.5（icacls/windows-acl） |
| **接続中は協働編集（P2.5a）**：per-slide 編集（フォーム/Markdown/図ドラッグ/→表/AI スライド適用）は**楽観ローカル＋debounce(600ms)で host へ往復**（set_slide_markdown・expectedRev/opId）。Undo/Redo は host の undo/redo へ再ルート。構造系（Draft 全置換/Load Template/プロジェクトを開く/batch/タブ切替）は接続中ロック維持。✍️ 協働編集中バッジ | **実装済（P2.5a）** | P2.5b：on-blur flush・per-doc apply-queue |
| **multi-doc**：projection は単一 doc を active deck にミラー。複数 doc / タブ橋渡しは未実装 | 単一 doc 可 | P2.5b（DocTabs↔docId） |
| **human 編集往復**：expectedRev ガード（never-silent stale）＋ opId echo 抑制 ＋ server-undo 再ルートを実装。stale/送信エラー/空 Undo はトーストで非サイレント | **実装済（P2.5a）** | presence・mid-type マージ・canUndo/canRedo のボタン反映は P2.5b |
| **reap 保証**：通常終了は reap。Rust 側パニック/外部 kill では孤児化し得る（std Child に Drop kill なし） | 通常終了で可 | 将来 Win32 Job Object |
| **start_collab**：sync コマンドで READY まで core thread をブロック（~1s／最大 15s）。他 IPC が一時キュー | 実用上可 | core thread 外へ |

### P2.5a（接続中の協働編集）実装ノート（branch `claude/p2-collab-roundtrip`）
観察モードを協働編集へ昇格。多エージェント敵対レビュー反映。
- **host**：6 mutating tool に任意 `opId`/`expectedRev`。`mutate()` は rev 不一致を never-silent な stale 拒否、`deckChanged` に `opId`（発信元の echo 抑制）。
- **projection**：`sendSlideMarkdown`（楽観送信・expectedRev・opId・stale 再 pull・送信中は pull 停止）、`recentSelfOpIds` で自分発 echo 抑制、`serverUndo/serverRedo`。
- **GUI**：`handleSlideUpdate` が接続中は楽観ローカル `setDeck` ＋ **per-index Map** にバッファ→debounce(600ms) で host へ順次送信（取りこぼし無し）。キーボード/ボタン Undo/Redo を host へ再ルート。stale/送信エラー/空 Undo はトースト。ref 同期は effect 内（react-hooks/refs 準拠）。
- **v1 割り切り（→ P2.5b）**：presence（「AI がスライド N 編集中」）／同一スライド mid-type マージ（同時編集は expectedRev で last-writer＋stale トースト）／`canUndo/canRedo` のボタン反映（今は接続中常時有効＋空 Undo トースト）／on-blur flush（今は 600ms idle debounce。`SlideMarkdownEditor` は !focused 時のみ外部 md を反映するのでカーソル飛びは防止）。
- **テストの穴**：per-slide 編集バッファ（A→B 取りこぼし無し）の単体テストは hook 描画基盤（RTL）が無く未追加。手動/WSL クロス検証で担保。

### 既知のエンジン課題（collab 外）
- `md-serializer` ↔ `md-slide-parser` の Title スライド非対称：`#` 見出しが Title レイアウトでタイトル枠に乗らない場合がある。seed をバイト経由にしたことで collab では顕在化しないが、エンジン側の往復不整合として残る（R4/R5 注意・別途）。
