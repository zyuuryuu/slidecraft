# SlideCraft ロードマップ

前向きの**テーマ**のみを記す。個別の作業項目（bug / task / 残作業）は
**[GitHub Issues](https://github.com/zyuuryuu/slidecraft/issues)** で追跡する（このファイルには溜めない —
CLAUDE.md「課題・記録の置き場」参照）。実装済みの履歴は [shipped.md](shipped.md)、決定は
[docs/adr/](adr/)、設計仕様は [docs/design/](design/)。

**現在地（2026-07-13）**：**v0.3.0 タグ打ち直し前**（draft のまま未公開）。目玉は **faithful Re-make**
（デザイン保持＋フォント正規化・[ADR-0027](adr/0027-remake-source-visual-preservation.md)・日本語 EA
フォント保持）＋**取り込み透明化 UX**（進捗/結果バー・ミニプレビュー・削除）＋**Master-Intake F0/F1
基盤**（任意マスターの取り込み理解＝病理センサス／sanitize-master 双子／決定論スコアラー／do-no-harm
ゲート・→[shipped](shipped.md)）。**AI Re-make（option C）は撤去**（[ADR-0028](adr/0028-retire-ai-remake-option-c.md)）。
取り込みは「忠実 Import／faithful Re-make／決定論 Re-make」に整理。

---

## テーマ（各作業は Issue で追跡）

| テーマ | 中身 | Issues |
| --- | --- | --- |
| **任意マスター取り込み理解** | scorer 復元の拡張（figure/subtitle）・複数 master・AI ラストマイル・geometryRole の header 誤認 | [`master-intake`](https://github.com/zyuuryuu/slidecraft/labels/master-intake) |
| **AI 編集の深化** | 部分生成 ops（P2–P4）・encoding 事故の構造抑止 | #106 #107 |
| **HTML / 描画品質** | 図のノード衝突/折返し・SmartArt/複雑図形の追随・@font-face CJK 埋め込み | #104 #105 #115 |
| **MCP / 連携** | エンドポイント2種の統合・スライドスクショ取得 | [`mcp`](https://github.com/zyuuryuu/slidecraft/labels/mcp) |
| **リリース / 配布** | アプリアイコン・Win 署名・Intel mac・通知/署名付き自動更新 | [`release`](https://github.com/zyuuryuu/slidecraft/labels/release) #114 #120 |
| **オーサリング / パーサ** | インデント・混在本文＋表・列内 table・セル整形・未閉じ fence | #88 #89 #100 #101 #102 #103 |
| **テンプレ資産 / 負債** | 内蔵30オミット・Re-make dark ロゴ・.scft version ゲート | [`tech-debt`](https://github.com/zyuuryuu/slidecraft/labels/tech-debt) #118 |
| **セキュリティ** | egress hard boundary（F1'・Rust ゲート） | #119 |

---

## 既知の仕様（非バグ・再調査不要）

- 表セル文字・図ノード文字は独立図形のため、スライドマスター body 書式には非追従（継承対象外）。
- **検証で棄却（2026-07-07）**：`get_deck_issues` 長い箇条書き過検知＝非バグ（検知は `SENTENCE_BULLET=28`、
  報告の `charsPerBullet:59` は別 budget）／空本文スライド未検出＝意図的仕様（title-only は正当）／
  大規模テンプレのロール推定ズレ＝偽（tbl/chart/pic は idx 分岐より先に尊重）。実在は
  [ADR-0023](adr/0023-third-party-master-idx-convention.md) 既知エッジ（規約 opt-in マスタの
  body@idx15/16 誤分類）のみで、素朴な typed-title ゲート修正は同梱テンプレを退行させるため不可。

---

## 依存・運用（継続追跡）

- **js-yaml v5** — dependabot PR #13（OPEN）：4.3.0 → 5.2.1（メジャー）。破壊的変更の確認待ち。
- **依存脆弱性** — 残 1 件＝`glib`（medium）は gtk-rs/Tauri スタックに固定＝**Tauri の GTK バインディング
  更新待ち**（実害小）。npm 系は vitepress 2.x（alpha）で解消済、stable 化したら追随。
- **会社 `.potx`(7) ＋ CX** — `tests/fixtures/templates/` に **gitignore**（知財・ローカル限定・skipIf のみ参照）。
