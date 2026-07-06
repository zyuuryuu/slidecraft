# ロードマップ規約

## ステートマーカー

| マーカー | 意味 |
|---------|------|
| ✅ READY | 実装可能 |
| 💬 DISCUSS | 設計未確定 |
| 🔗 DEPENDS | ブロッカーあり |
| 🏁 完了 | 完了 |

## 工数サイズ

| サイズ | 目安 |
|-------|------|
| S | 1 日未満 |
| M | 2-3 日 |
| L | 1 週間 |
| XL | 2 週間以上 |

## ドキュメント更新ルール

ドキュメントは役割で分離する:
- **決定の記録 → `docs/adr/`**：アーキ決定をしたら ADR を1本追加（番号採番・`Context / Decision / Consequences / References`）。ADR は原則 immutable、覆す場合は新 ADR で supersede（古い方の Status を Superseded に）。
- **前方向きの計画 → `docs/ROADMAP.md`**：**将来項目のみ**。完了したら表から外す。現在地は短いポインタに留め、完了プロズを溜めない（読みやすさ優先）。
- **実装済みの履歴 → `docs/shipped.md`**：出荷済み機能の browsable ログ（テーマ別・1機能1行・`ADR-XXXX／PR #NN／日付` 付き）。ROADMAP から外した完了項目はここに1行追記する。詳細な経緯は ADR ＋ git（PR）。
- **詳細設計 → `docs/design/`**：ADR から参照する補助資料。
- **使い方 → `docs/mcp-server.md` 等**：エンドユーザ/連携者向けガイド。

機能/フェーズ完了時：(1) 該当 ADR を追加 or 更新、(2) **ROADMAP から完了項目を除去し `docs/shipped.md` に1行追記**、(3) テスト数は git コミット/PR に記録。
