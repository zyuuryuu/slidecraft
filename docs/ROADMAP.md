# SlideCraft ロードマップ

前向きの**テーマ**のみを記す。個別の作業項目（bug / task / 残作業）は
**[GitHub Issues](https://github.com/zyuuryuu/slidecraft/issues)** で追跡する（このファイルには溜めない —
CLAUDE.md「課題・記録の置き場」参照）。実装済みの履歴は [shipped.md](shipped.md)、決定は
[docs/adr/](adr/)、設計仕様は [docs/design/](design/)。

**現在地（2026-07-19）**：v0.3.0 タグ済み。直近マイルストーンは **BindingPlan＝束縛の単一権威化**
（[ADR-0030](adr/0030-binding-plan-single-authority.md)・段階A/B 完了＝未束縛の warn 化＋
serializer/GUI 全経路の写像統一。C–E は下表）、**保守性ゲート**（[ADR-0031](adr/0031-maintainability-gates.md)・
arch-conformance が CI 必須化・R8 一致テスト規則）、**敵対 fixture 第2弾＋型×幾何の矛盾センサス**
（実コーパスで矛盾 0＝type メタデータ信頼の実証 → 層1の梯子→融合転換は当面不要、というデータ決着）、
**オーサリング拡張の完了**（ノート記法 #150・章タグ/目次 #151・アジェンダ再掲 #167・フッタ章名 #168＝全出荷・ADR-0032 系）、**変換レポートの完成**（パース時フォールバック計上 #148）。

---

## テーマ（各作業は Issue で追跡）

| テーマ | 中身 | Issues |
| --- | --- | --- |
| **束縛の一元化（ADR-0030 C–E）** | 段階C（グループ超過の根治）→ D（buildFieldMap）→ E（group 統合・着手時に起票） | #135 |
| **オーサリング表現力（ADR-0032）** | ネスト箇条書き | #103 |
| **パーサ / 診断** | 列内表/混在本文・グループセル見出し・GUI コメント段落（要判断）・先頭章扉の表紙誤解決 | #100 #101 #102 #165 #195 |
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

- **dependabot OPEN**：#123 `serde_with` 3.21（security fix 含む・cargo）・#93 `sysinfo` 0.39・
  #92 `gitleaks-action` v3（Node 24 移行）。js-yaml v5（メジャー）はブランチのみ＝破壊的変更の確認待ち。
- **依存脆弱性** — 残 1 件＝`glib`（medium）は gtk-rs/Tauri スタックに固定＝**Tauri の GTK バインディング
  更新待ち**（実害小）。
- **会社 `.potx`(7) ＋ CX** — `tests/fixtures/templates/` に **gitignore**（知財・ローカル限定・skipIf のみ参照）。
  再現可能な代替は Dirty_* 合成 fixture 群＋（将来）#143 の双子。
