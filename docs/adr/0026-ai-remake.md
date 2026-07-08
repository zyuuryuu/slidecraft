# ADR-0026: AI 非決定 Re-make（第3の取り込み口・構造マッピング）

- Status: Accepted
- Date: 2026-07-08
- 詳細設計: [docs/design/ai-remake.md](../design/ai-remake.md)
- 関連: [ADR-0023](0023-third-party-master-idx-convention.md)（決定論 Re-make）／[ADR-0014](0014-template-authoring.md)（AI が spec 提案）／[ADR-0018](0018-validation-at-adoption-gate.md)（採用ゲート）／[ADR-0005](0005-harness-over-model.md)（harness over model）／[ADR-0025](0025-placeholder-role-resolution.md)＋layout 選出 Tier1/2

## Context

スライドマスター取り込みは①丸ごと忠実 ②決定論 Re-make（テーマ抽出→固定30 canonical レイアウト）の
2択。乱雑な第三者マスターは忠実 Import だとロール/レイアウト/idx が不定で、**実行時にヒューリスティック
で“解釈”**する必要がある（ADR-0025 の title リカバリ、layout 選出 Tier1/2 の gate 群がこの継続対処）。
決定論 Re-make は clean だが**固定レイアウトに載せ替えるため source 固有のレイアウト構造/意図を捨てる**。

## Decision

**第3の取り込み口＝AI 非決定 Re-make を追加する。粒度は「構造マッピング」（案 C）**:

- **AI＝分類器のみ**。各 source レイアウトを**最適な canonical レイアウト（`BUILTIN_LAYOUTS`）へ写す
  選択＋改名**だけを行う。ターゲットが canonically-typed の clean レイアウトなので、**ロールは構造的に
  正しい＝不整合が取り込み時に一度で消える**（実行時ヒューリスティックの負担を軽減）。
- **それ以外は決定論**（harness over model・ADR-0005）: テーマ抽出＝`masterToTemplateSpec`、
  幾何/スタイル＝canonical ライブラリ、検証＝スキーマ／語彙内チェック／`assessTemplateHealth`／
  contrast-guard／`writeTemplate`→`loadTemplate` 往復。
- **never worse の floor**: 壊れ/空/全ハルシネーション応答は**決定論 Re-make にフォールバック**。
- 実装は既存部品の合流（`master-remake-ai.ts` の inventory/prompt/parse/compose/fallback ＋
  既存 template-spec AI 経路 ＋ `writeTemplate` ＋ サブセット選択機構 ＋ best-of-N/採用ゲート）。

**却下/保留した代替**: A（theme のみ・レイアウト柔軟性ゼロ＝狙いを満たさない）／B（AI がフル幾何を
著述・小モデルに難＋検証負荷大＋harness-over-model と逆行。canonical に無い固有構造が要る時の将来 Phase）。

## Consequences

- **不整合を“対症（実行時解釈）”から“予防（取り込み時 clean 化）”へ**。
- **小モデルで実用（実証済）**: Phase-0 で `granite4.1:8b` × CX_sample（22 レイアウト）→ valid JSON・
  ハルシネーション0・写像妥当（決定論のロール誤りより賢い例あり）・往復 health=ok（[設計 §5](../design/ai-remake.md)）。
- **柔軟性**: source のレイアウト SET を保持（name 単位で各 source レイアウトを別レイアウト化）。
- 非決定性は採用ゲート＋人間のプレビュー確認で担保。UI は忠実/決定論/AI の3択（既定は決定論、
  不満なら AI）。
- 限界: canonical に無い真に固有な構造は写せない（案 B の将来 Phase）。多くのマスターは canonical に
  近く決定論で足りる可能性 — AI が効くのは固有度の高いマスター。

## References

- 実装: `src/engine/master-remake-ai.ts`（Phase-0 スカフォールディング・test-first `master-remake-ai.test.ts`）
- 設計・Phase-0 実測: [docs/design/ai-remake.md](../design/ai-remake.md)
