# SlideCraft ロードマップ

前方向きの計画のみを記す。完了フェーズの履歴は **ADR ＋ git（PR）** に移管済み。決定の記録は `docs/adr/` を参照。

**現在地（2026-07-04）**：土台（テンプレ堅牢性）・差別化アーキ（内蔵 AI＝llamafile 同梱 P1〜P6）・
**プロンプト磨き込み**（構造ヘッダー保全 [ADR-0012](adr/0012-ai-edit-structure-preservation.md)、敵対検証ハードニング、
生成 payload 保全 #12、design-op 告知 #13、テキストスライドへ図追加 #3B、図生成の二段構え、プロンプト整合 #3・#1）
まで完了（PR #58）。**UI 磨き込み**（AI Assist＋協働を1つの ✨AI ドックにタブ統合・マスターピッカーを Top/Draft 共通の
単一プルダウンに刷新・Draft ヘッダ整理）も反映（PR #59）。次は **機能フェーズ**。詳細は開発メモリ `roadmap_post_p2`。

---

## 次の主要テーマ（優先順）

| # | テーマ | 一行 | サイズ |
|---|--------|------|-------|
| 1 | **HTML 出力**（大マイルストーン） | 磨き込んだ Web preview をスタンダロン HTML プレゼンとして出力 | L |
| 2 | **テンプレ作成補助** | 新テンプレの作成/登録支援。原稿→マスター整形と重なる最大機能 | L |

> **テーマ1「HTML 出力」（大マイルストーン）**：
>
> - 磨き込んだ **Web preview（`SlidePreview` の CSS 忠実描画）をスタンダロン HTML プレゼンとして出力**。PowerPoint 離れ・HTML プレゼンの潮流に対応。
> - 自己完結（インライン CSS/JS・スライド送りナビゲーション）。図/表/コード/プレースホルダ描画を HTML に写像（既存の共有描画モデルを HTML レンダラに）。PPTX 出力と併存。
> - サイズ L〜XL。詳細設計は着手時に `docs/design/`（ADR 級）。

> **既知の仕様（非バグ・再調査不要）**：表セル文字・図ノード文字は独立図形のため、スライドマスター body 書式には非追従（継承対象外）。

---

## バックログ（将来）

| 項目 | 内容 | サイズ |
|------|------|-------|
| 自動アップデート | Tauri Updater 経由（GitHub Releases） | M |
| アプリアイコン正式デザイン | 仮アイコン（青背景 "S"）を正式版へ差し替え | S |
| 画像・チャートの Markdown 埋め込み | `![alt](path)` / ```` ```chart ```` ブロック対応 | L |
| テーマ切り替え / テンプレ管理 | 複数テンプレ PPTX の**永続管理・切替の本体**（現状はセッション内レジストリのみ）。マスターピッカーは Top/Draft 共通の単一プルダウンに刷新済み・旧「Load Template」は撤去済み（PR #59） | M |
| テンプレ資産の棚卸 | `public/templates/slide/` に `.potx`（未追跡6）＋`_全レイアウト見本.pptx`（tracked）が堆積。**アプリが束ねる built-in は canonical `Midnight_Executive_30_TemplateOnly.pptx` 1本のみ**（ディレクトリ列挙なし）。棚卸：参照ゼロの見本7件＋未追跡 `.potx` を「テンプレ管理」機能で**束ねる(A)** か **整理/削除(B)** か決定。将来案：データを **`.potx` 形式に一本化**（見本は生成 or 廃止）。⚠ **テスト fixture（`lrk-slides-velis_CC0`／`報告書テンプレート_全レイアウト見本`／`配布資料_公文書高密度_全レイアウト見本`／`報告書テンプレート_官公庁_全レイアウト見本`）は削除不可**。↑「テンプレ管理」と一緒に着手 | S |
| ユーザ利用ガイド | 図 14 種・二段階編集・テンプレ流し込みを網羅したオンボーディング | M |
| 生成の encoding 事故を構造で抑止（#12-D） | 弱モデルの `\uXXXX` 違反を**発生させない**根本抑止。案：(D-1) 生成を per-slide 分割し違反の被害半径を1枚に＋壊れた1枚だけ再試行（`extractSlidePlan` 既存）／(D-2) 本文を JSON 文字列から出しエスケープ不要な形式へ。現状は floor（違反破棄＋告知＝#12-5 C）で担保済。着手時に設計 | M |
| 図編集 diff の見た目 | AI 図編集（diagram-edit）の変更プレビューが「フル Markdown vs 生 YAML」比較で見た目がズレる。図編集時は YAML 同士で diff（採用の動作は 6d036d1 で修正済・これは cosmetic） | S |
| フィールドクリアで空 ph が残る | 欄をクリアすると空パラグラフの placeholder がモデルに残る（1:1 には無害・export cleanliness の観点で将来検討） | S |
| serializer: 単独 content スライドが空出力 | index 0 の content スライドが autoSelect で Title 扱いになり、title(idx15) を idx0 として読むため空シリアライズ。`currentSlideMd` は解決済レイアウトをピンして回避済だが `serializeMd` 直呼びで露出 | S |

---

## 保留中の依存・運用

- **#34** — ブロッカー解消待ち。
- **#13 / js-yaml5** — 依存更新待ち（YAML パーサ）。
- **GitHub Actions（NEXT・要対応）** — 請求枠リセット日（2026-07-01）は経過済だが、`actions/permissions` は
  `{"enabled": false}` の**まま**（要再確認）。**軽量化してから再有効化**する（3-OS マトリクスは release-only、
  push は Linux のみ、docs は paths-ignore、npm/build キャッシュ、concurrency）。再有効化まで mac 署名 P6 実機検証
  （[[llamafile_runtime_design]]）はブロック。開発メモリ `ci_actions_billing`。
- **実験用一時ファイルの後始末** — テンプレ検証・headless 生成で散らかった temp 出力を整理（↑「テンプレ資産の棚卸」と関連）。
