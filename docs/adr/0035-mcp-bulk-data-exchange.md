# ADR-0035: MCP のバルクデータ授受 — データプレーン階段（fs → loopback binary → base64）

- Status: Accepted（2026-07-21）／実装は段階的（#299・出力側先行）
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
2. **loopback binary（fs 無し・到達可）** — 協働ホストが既に持つ loopback HTTP（`host.ts`）に**バイナリ配信
   ルート**を足し、URL を返す。クライアントが raw bytes を stream で取得＝バイナリネイティブ・**+33% なし・
   モデル文脈を通過しない**（host が取得）。単独 stdio でも必要時に同等のローカル HTTP／socket を建てられる。
3. **base64 インライン（真に隔離時のみ）** — 共有 fs も到達可能なバイナリ経路も無い時の**唯一の物理手段**。
   既定から外し、境界条件の**最終 fallback** に降格。従来の base64 経路は **byte-identical に温存**（非破壊）。

閾値超えのバイトを参照化する（小物の base64 は許容）。既定は現状（base64）を壊さず、fs／loopback は
opt-in ／ capability で選択する。

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
- (−) 段階実装（出力先行 → loopback → 入力）とクライアント capability（`roots` 有無）分岐の**テストコスト**。
- **[ADR-0007](0007-mcp-server-design.md) を部分 supersede**（「`--no-fs` のみ」の制約を段階解除。base64 経路自体は存続）。

## References

- [ADR-0007](0007-mcp-server-design.md)（MCP サーバ設計・`--no-fs`）・[ADR-0010](0010-security-model.md)
  （セキュリティ・no-fs／scoped・token 境界）・[ADR-0009](0009-p2-collab-host.md)（協働ホスト loopback HTTP＝
  data plane の素地）・[ADR-0033](0033-mcp-single-control-plane.md)（単一管制）
- 触点：`src/mcp/cli.ts`（`--root`／`roots`）・`src/mcp/session.ts`（fs 配線）・`new_project`／`open_project`／
  `export_pptx`／`save_project`（参照 I/O）・`src/mcp/host.ts`（loopback binary route）
- 契機：#299（実機フィードバック・base64 肥大）
