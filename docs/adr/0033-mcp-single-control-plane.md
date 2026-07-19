# ADR-0033: MCP の単一管制（control plane）— 口は薄いアダプタ・管制は1つ

- Status: Accepted
- Date: 2026-07-19

## Context

MCP は現在「口（transport）」が2つある：**stdio**（`cli.ts` が spawn される headless 単独 AI 用）と
**collab host**（`host.ts`・HTTP ループバック・GUI＋外部 AI の live 協働用・ADR-0009）。ツールの登録面自体は
単一 `buildServer`（`server.ts`）に一本化済みで**ツール実装の重複は無い**。問題はその下：

1. **管制（deck 権威／mutation 確定／undo／doc lifecycle）が2実装。**
   - stdio 側 = `buildServer` の `!host` 分岐＋`cli.ts` の**単一 `Session`**。dirty フラグ＋`onMutate` のみで
     **undo 履歴を持たない**。
   - host 側 = `host-core.ts` の `DocRegistry` ＋ `commitMutation`（no-op ゲート＋`rev`＋undo 履歴＋fan-out）。
   deck を持ち・変更を確定し・undo を管理する**権威が二重**にある。これが今後の複雑さの源。
2. **stdio は host が無かった頃の“やっつけ”の単独サーバ**で、多機能な host（上位版）と非対称に併存している。
   非対称の実体：stdio は `deck://` リソースを持つが lifecycle（undo/redo/select/templates）が無い、host は逆。
3. **「ライブ追随を stdio に足す」半端な再利用（stdio↔host ブリッジ）は最悪手**。2つのクリーンな口でも
   1つの管制でもない third option で、二重管制を温存したまま結合だけ増やす。

トポロジの事実：**stdio 1本 = クライアント1つ**（spawn した側がパイプを専有）。GUI↔AI の live 共有には
複数クライアントを捌くブローカーが要り、それが collab host（HTTP ループバック）＝**host は既に richer な superset**。

## Decision

原則：**transport（口）は薄いアダプタ＝何個あってもよい。control plane（管制：deck 権威／`commitMutation`／
undo／doc lifecycle）は単一。** 複雑さは口の数ではなく**管制の数**から来る。

### D1（今回）— 管制を単一に一本化

- **単一管制 = `host-core.ts` の `DocRegistry` ＋ `commitMutation` ＋ undo**。deck 権威・変更確定・undo・
  doc lifecycle は全てここに集約。
- **stdio 専用管制を廃止**：`buildServer` の `if (!host)` mutate 分岐（単一 `Session` を直接いじる経路）を削除し、
  **全 mutation が `commitMutation` を通る**。`cli.ts` は単独サーバをやめ、**host サーバの薄い stdio アダプタ**に
  なる（solo な `HostContext`：doc 1枚・`active()`＝`soleDocId()`〔既存〕・token 無し・`sharedOnly:false`・
  `registerResources:true`）。
- **非対称の解消**：リソースの有無は「2サーバ」ではなく**口ごとの config フラグ**に。solo-stdio は GUI 無し＝
  read 面が要るので resource **on**、collab-HTTP は GUI が read 面なので resource **off**（今のまま）。
- **口は2つ（stdio / HTTP）とも薄いアダプタとして存続**。廃止するのは口ではなく「2つ目の管制」。

### D2（計画・D1 完了後）— client から見た口も1エンドポイントに（R1 adaptive front）

「1アプリに MCP 設定が複数」という違和感を解消する runtime レイヤ。

- **`slidecraft mcp`（stdio）を単一の client-facing エントリ**にする。起動時に稼働中の管制を discover
  （`host.json`/lock）→ **居れば薄く forward・居なければ solo で管制を建てる**。管制は常に1つ（先着が建て、
  後着が相乗り）。
- 唯一の不純物＝協働時の**状態ゼロの relay 1 hop**。口の adapter 仕事であって half-reuse ではない
  （管制は複製しない）。
- 検討した代替：二設定容認（stdio＋HTTP-URL の2エントリ＝違和感が残る）・常駐 daemon＋HTTP（lifecycle が重い）。
  **R1 を採る**。相乗り先＝単一管制が実在してから設計する方が容易なので **D1 完了後**に着手。

### 北極星（今回スコープ外）

GUI 内蔵 AI 経路（`ai-apply.ts`・#220）も最終的に同一管制（`commitMutation`）へ合流させれば、**deck を触る
全経路が単一権威に集約**する。膨らむため今回は入れない（#220 として別追跡）。

### やらないこと

- stdio↔host の状態を二重に持つブリッジ（half-reuse）。
- 管制の複製を温存したままの結合追加。カバレッジ%目標や daemon 常設は D2 の代替検討にとどめ不採用。

## Consequences

- (+) deck 権威／mutation 確定／undo が**単一** ＝ 「今後の複雑さ」の源を断つ。stdio/host の非対称が消える。
- (+) solo-stdio も undo/redo・lifecycle を持つ（**additive**・既存クライアント非破壊）。templates は headless で
  registry 未登録＝`create_template` ヒントへ never-silent degrade（既存挙動のまま）。
- (−) stdio surface が additive に増える（solo でも undo/redo/list/select 等が生える）。1 doc で実質 no-op な
  ものは無害。
- (−) `deck://`/`slide://` リソースの読み元を「単一 `Session`」から「sole doc の session」へ小配線
  （`resources.ts`）。
- **ADR-0007 を部分 supersede**（stdio の単一管制／単独サーバの廃止のみ。決定論レバー・native-only export・
  `--no-fs` は存続）。**ADR-0022（cli bundle）は更新**（bundle は host サーバ＋stdio アダプタを内包する）。
  **ADR-0009 の host 管制を唯一の管制に格上げ**。
- (−) D2（client 側 1エンドポイント）の discover/relay/rendezvous は別スライス（D1 の上の runtime レイヤ）。

## References

- ADR-0007（MCP サーバ設計・本 ADR が**部分 supersede**）・ADR-0009（P2 協働ホスト＝単一管制の母体）・
  ADR-0022（cli bundle・**更新**）・ADR-0006（headless MCP 先行・OS ユーザ=信頼）・ADR-0010（token 境界・
  loopback）・ADR-0015（MCP ツール面）
- 触点：`src/mcp/cli.ts`・`host.ts`・`host-main.ts`・`host-core.ts`（`DocRegistry`/`commitMutation`/
  `soleDocId`）・`server.ts`（`buildServer` opts：`host`/`registerResources`・`if(!host)` 分岐）・`resources.ts`
- 北極星：#220（GUI `ai-apply` 経路の同一管制合流）
