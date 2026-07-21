# ADR-0035: MCP のバルクデータ授受 — データプレーン階段（fs → loopback binary → base64）

- Status: Accepted（2026-07-21）／fs（①出力・③入力）実装済み・**②loopback binary は不採用**（下記 addendum 2026-07-21）
- Date: 2026-07-21

## Context

v0.4.0 の MCP は `--no-fs` のみ（[ADR-0007](0007-mcp-server-design.md)）＝`.pptx`/`.scft` のバイト列を
**base64 で stdio（JSON-RPC）授受**する。実機フィードバック（#299・2026-07-20）：大きいテンプレ／画像入り
デッキだと base64（**+33%**）が MCP チャネルと上流 AI の**コンテキスト**を圧迫し、トークン費用・サイズ上限・
レイテンシで**機能として非現実的**になる。

JSON-RPC はテキストなので、バイトを**インラインで載せる**限り base64（または別テキスト符号化。base85 等でも
利得は数 %）は不可避。だが問題の本質は「符号化効率」ではなく「**バルクをチャネルに載せていること**」——
上流 AI は base64 文字列をモデル文脈に載せて受け渡す実装が多く、そこが律速になる。

## Decision

**バルクバイトを JSON-RPC（control plane）に載せない。** バイトの実体は out-of-band（data plane）で運び、
JSON-RPC には**参照（パス / URL / ハンドル）だけ**を載せる。データプレーンは可用性で段階選択し、
never-silent にフォールバックする：

1. **fs（共有ファイルシステムあり＝ローカル）** — サーバは**スコープ付き交換ディレクトリ**内だけ読み書きし、
   パス／`file://` を返す。scope の出どころは **MCP `roots`（優先＝クライアントが scope を制御・最小権限）→
   `--root <dir>`（roots 非対応クライアント向け fallback）**。入力・出力とも**同一の scoped dir** を通す。
   サーバの fs アクセスはその 1 ディレクトリに封じる（arbitrary read/write なし）。
2. ~~**loopback binary（fs 無し・到達可）** — 協働ホストが既に持つ loopback HTTP（`host.ts`）に**バイナリ配信
   ルート**を足し、URL を返す。~~ **→ 不採用（下記 addendum）**。当初は fs と base64 の中間段として想定したが、
   認証（token）を持てる消費者が実在の推奨経路に居ないことが判明したため実装しない。
3. **base64 インライン（fs が共有できない時）** — 共有 fs が無い時の**唯一の物理手段**。既定から外さず（②が無い
   ので）、fs（`--root`）を使えない環境の経路として温存。従来の base64 経路は **byte-identical に温存**（非破壊）。

閾値超えのバイトを参照化する（小物の base64 は許容）。既定は現状（base64）を壊さず、fs（`--root`）は
opt-in で選択する。

### Addendum（2026-07-21）：②loopback binary を不採用

③（入力側 fs）実装（#306）後、②の実消費者を精査した結果、**②は実装しない**と決定：

- **stdio-forward の上流 AI**（#299 の主役）は token を持たない。forward モードで token を握るのは中継役
  `cli.ts`（relay）で、AI は cli.ts と stdio で話すだけ。**AI は認証付きの `/blob` を fetch できない**。
  relay が代理 fetch しても、AI に渡すには base64 に戻す（無意味）か、ローカルファイルに書いてパス返し
  （＝それは①③の fs）。②では解けない。
- **Webview（GUI 自身）** は host と同一プロセス群で、deck 状態を collab-client の projection で**直接読む**。
  MCP のバイト転送を必要としない。
- ②が uniquely 効くのは **HTTP エンドポイント直登録のクライアント**だけ。だがそれは
  [ADR-0033](0033-mcp-single-control-plane.md)（アダプティブフロント）＋#283/#297 で「やめろ」と誘導した
  **アンチパターン**の経路。

結論：**①③（fs）＋ base64 fallback で、推奨経路（stdio 登録）の実消費者を充足**する。②は「token を持てない
forward 経由 AI には届かず、他は fs／projection で足りる」ため不要。将来 HTTP-direct を第一級で支える必要が
生じたら、その時に別 ADR で再検討する。データプレーンは実質 **fs（`--root`）→ base64** の 2 段に収束した。

### 不変条件 / 硬化

- fs アクセスは **scoped dir 配下限定**・`../` traversal 禁止・symlink 越え拒否・すべて never-silent
  （`{ok:false, code}`）。[ADR-0010](0010-security-model.md)（no-fs／scoped・token 境界）の scoped-fs 方針を具体化。
- **engine 純度（R2）維持**：fs／HTTP は `src/mcp`・IPC 層に閉じ、`src/engine/*` には持ち込まない。
- **`--no-fs`（base64）既定は非破壊で温存**（既存クライアント保護・回帰なし）。

## Consequences

- (+) 大きい `.pptx`／デッキで base64 が消え、モデル文脈・トークン費用・レイテンシが激減。
- (+) 入力・出力を**1 つの scoped 機構**に統一（別機構を増やさない）。`roots` で scope をクライアントが制御＝最小権限。
- (+) base64 の出番が「真に隔離」時**だけ**に縮む（物理的必然のみ・妥協ではない）。
- (−) fs 境界の導入＝**新しい攻撃面**（scope 硬化・traversal／symlink 対策が必須）。ADR-0007／0010 の補追。
- (＝) **②loopback binary は不採用**（上記 addendum）＝ data plane は **fs（`--root`）→ base64** の 2 段に収束。
  実装/攻撃面/テストコストを1つ増やさずに済んだ。MCP `roots`（`--root` の代替 scope 源）は将来の follow-up。
- **[ADR-0007](0007-mcp-server-design.md) を部分 supersede**（「`--no-fs` のみ」の制約を解除。base64 経路自体は存続）。

## References

- [ADR-0007](0007-mcp-server-design.md)（MCP サーバ設計・`--no-fs`）・[ADR-0010](0010-security-model.md)
  （セキュリティ・no-fs／scoped・token 境界）・[ADR-0009](0009-p2-collab-host.md)（協働ホスト loopback HTTP＝
  data plane の素地）・[ADR-0033](0033-mcp-single-control-plane.md)（単一管制）
- 触点：`src/mcp/cli.ts`（`--root`）・`src/mcp/fs-scope.ts`（fs chokepoint・read/write）・`new_project`／
  `open_project`／`export_pptx`／`save_project`（参照 I/O）
- 実装：①出力 PR #304・返り値 file:// URI PR #305・③入力 PR #306。②loopback は不採用（addendum）。
- 契機：#299（実機フィードバック・base64 肥大）
