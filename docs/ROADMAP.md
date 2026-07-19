# SlideCraft ロードマップ

前向きの**テーマ**のみを記す。個別の作業項目（bug / task / 残作業）は
**[GitHub Issues](https://github.com/zyuuryuu/slidecraft/issues)** で追跡する（このファイルには溜めない —
CLAUDE.md「課題・記録の置き場」参照）。実装済みの履歴は [shipped.md](shipped.md)、決定は
[docs/adr/](adr/)、設計仕様は [docs/design/](design/)。

**現在地（2026-07-19）**：v0.3.0 タグ済み。直近の出荷＝ **ADR-0032 オーサリング拡張の完了**
（ノート #150・章/目次 #151・アジェンダ再掲 #167・フッタ章名 #168）、**変換レポートの完成**（#148）、
**ネスト箇条書き 3段**（#103）、**CJK フォント埋め込みの完成**（#115＝#192 スタック＋#193 サブセット化/Noto
同梱＋#194 @font-face 配線・生 TTF 埋め込み）、**パーサ round-trip の堅牢化**（表と本文の共存/列内表 #100/#101・
セル内 `##` 見出し＋Midnight buChar #102・GUI コメント段落保全 #165）、**表の内容比例列幅**（#138/#139）、
**BindingPlan 段階A–C 相当**（silent-drop の warn 化と診断 floor まで完了・#135 クローズ）。詳細は [shipped.md](shipped.md)。

---

## テーマ（各作業は Issue で追跡）

| テーマ | 中身 | Issues |
| --- | --- | --- |
| **束縛の一元化（ADR-0030 D–E）** | 段階D（buildFieldMap）→ E（group 統合）— 着手時に起票（段階C 相当の診断 floor は #135 で完了） | — |
| **任意マスター取り込み理解** | 未束縛の UI surface・複数 master・野生コーパス収集・AI ラストマイル・表紙 subtitle（証拠待ち） | [`master-intake`](https://github.com/zyuuryuu/slidecraft/labels/master-intake)（#97 #99 #116 #128 #143） |
| **既定テンプレ品質** | 内蔵30オミット・Re-make dark ロゴ | #117 #118 |
| **表・描画 / HTML** | 図ノード衝突/折返し・SmartArt 追随（@font-face CJK 埋め込み #115 は #192/#193/#194 で完了・shipped.md 参照） | #104 #105 |
| **AI 編集の深化** | 部分生成 ops（P2–P4）・encoding 事故の構造抑止 | #106 #107 |
| **GUI / アプリ堅牢性** | 最背面画像ドラッグ・Help 導線・.scft version ゲート | #122 #114 #121 |
| **MCP / 連携** | スライドスクショ取得（上流 AI の視覚レビューループ） | [`mcp`](https://github.com/zyuuryuu/slidecraft/labels/mcp)（#109） |
| **リリース / 配布 / セキュリティ** | アプリアイコン・Win 署名・Intel mac・通知/署名付き自動更新・egress hard boundary | [`release`](https://github.com/zyuuryuu/slidecraft/labels/release)（#110–#113 #120）・#119 |
| **保守性（ADR-0031 運用）** | 凍結/許可リストの ratchet 縮小（分割は #129 型・継続運用） | — |

---

## 既知の仕様（非バグ・再調査不要）

- 表セル文字・図ノード文字は独立図形のため、スライドマスター body 書式には非追従（継承対象外）。
- **検証で棄却（2026-07-07）**：`get_deck_issues` 長い箇条書き過検知＝非バグ（検知は `SENTENCE_BULLET=28`、
  報告の `charsPerBullet:59` は別 budget）／空本文スライド未検出＝意図的仕様（title-only は正当）／
  大規模テンプレのロール推定ズレ＝偽（tbl/chart/pic は idx 分岐より先に尊重）。実在は
  [ADR-0023](adr/0023-third-party-master-idx-convention.md) 既知エッジ（規約 opt-in マスタの
  body@idx15/16 誤分類）のみで、素朴な typed-title ゲート修正は同梱テンプレを退行させるため不可。
- **矛盾センサスで実証（2026-07-19・#146）**：実コーパス（会社 .potx 7種＋CX）で type×幾何の矛盾 0
  ＝type メタデータは健全マスターで信頼できる。幾何の重み上げが効くのは velis 型の野生テンプレのみ
  → 層1の梯子→融合転換は #143（野生コーパス）で実例が溜まったら再計測して判断。

---

## 依存・運用（継続追跡）

- **dependabot**：滞留分は 2026-07-19 に全件処理 — #123 `serde_with`（security fix）・#92 `gitleaks-action`
  v3・#90 `tauri-action` v1（CI build で実走検証）・#93 `sysinfo` 0.39 をマージ、js-yaml v5（メジャー）は
  破壊的変更（default export 廃止・空入力 throw）の移行込みで PR #204 として処理（`engine/yaml-io.ts` に
  v4 互換を一本化）。
- **依存脆弱性** — 残 1 件＝`glib`（medium）は gtk-rs/Tauri スタックに固定＝**Tauri の GTK バインディング
  更新待ち**（実害小）。
- **会社 `.potx`(7) ＋ CX** — `tests/fixtures/templates/` に **gitignore**（知財・ローカル限定・skipIf のみ参照）。
  再現可能な代替は Dirty_* 合成 fixture 群＋（将来）#143 の双子。
