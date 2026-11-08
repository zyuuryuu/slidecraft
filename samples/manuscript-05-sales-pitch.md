<!-- セールスピッチ（提案・ピッチ）14 枚 — #580 目標デッキ A。素材 = manuscript-01-business-proposal.md。（仮）= 原稿に無い数値・社名・価格（構造を試すための仮置き）。内蔵テンプレ「セールスピッチ Pitch」向け -->

# 社内ナレッジ検索「Hubble」導入のご提案
> 探す時間を、考える時間へ。

Category: ご提案
Date: 2026-11
Footer: 社外秘

---

<!-- statement -->
# 必要な情報に、15 分かけていませんか。

---

# いま起きている 3 つの「探せない」

<!-- card -->
### :storage: 散在
- 共有ストレージ・チャット・SaaS・個人 PC に分散

<!-- card -->
### :client: 属人化
- 誰に聞けばよいかを知る人が限られる

<!-- card -->
### :firewall: 取りこぼし
- 完全一致検索では言い回しの揺れで見つからない

Takeaway: 情報はあるのに、組織として再利用できていない

---

# 1 件の検索が 15 分 → 2 分に

<!-- kpi -->
### 検索時間
- **2 分**
- 1 件あたり平均（現状 15 分）

---

# Hubble とは

- 主要な社内ツールを横断して検索
- 自然言語の問いかけに、要約つきで回答
- 権限は既存の認証基盤と統合

![製品画面（仮）](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAASCAIAAAC1qksFAAAA20lEQVR4nLXMaUvCAAAG4PeHCxFEBBJICBFEBMMQTczwKLXDA03Lg1I8UOcO1+bcnGuen/oV7/MDHjjewXL3prPT7Z1mbVVzKxkbUV+PtPVQ9fqK15X+fkS3PXGbo9XXcFUbONXestxdFjv2+7f90rZyrcVTY5H+NJN1M/Exj1eM+7IRKenhgh56+wV1F141UPfbvAbqfpOdgbpfP89A3a8yKqj7ZUoBdQ8mFVD3i0cZ1D3wIIO6n8clUHd/bArqfhadgrqfRkRQ95OwCOp+fDcBdT8KjUHdfcL4H7qpdC8LCYyWAAAAAElFTkSuQmCC)

---

# 3 つの価値

<!-- card -->
### :internet: 横断
- 散在する情報資産を一度に検索

<!-- card -->
### :monitor: 文意理解
- 表現の揺れに強い自然言語検索

<!-- card -->
### :vpn: 安全
- 閲覧権限の範囲だけを対象

---

# しくみ

```diagram
type: flowchart
direction: LR
nodes:
  - { id: src, label: 社内ツール群 }
  - { id: idx, label: 横断インデックス }
  - { id: q, label: 自然言語の問い }
  - { id: ans, label: 要約つき回答 }
edges:
  - { from: src, to: idx }
  - { from: q, to: idx }
  - { from: idx, to: ans }
```

---

# 導入で変わること

<!-- before -->
### いま
- 複数ツールを行き来して手で突き合わせ
- ベテランへの問い合わせが集中

<!-- after -->
### 導入後
- 1 回の問いかけで要約つきの答え
- 問い合わせは月 40% 減

---

# 期待効果

<!-- kpi -->
### 検索時間
- 15 分 → 2 分

<!-- kpi -->
### 問い合わせ
- 月 40% 減

<!-- kpi -->
### 立ち上がり
- 3 週 → 2 週

<!-- kpi -->
### 投資回収
- 12 カ月

Source: 社内試算（原稿「期待効果」）

---

<!-- quote -->
# お客様の声（仮）

「どこにあるか分からなかった過去提案が、1 回の質問で出てくる。」

— パイロット部門 マネージャー（仮）

---

<!-- ロゴウォール（ロゴを何枚も並べる）は 1 枚に画像を 2 枚以上置く記法（#392）の後。それまでは実績の要約＋まとめたロゴ画像 1 枚で表す -->
# 導入実績（仮）

- パイロット 4 社・延べ 1,200 名が利用

![導入企業ロゴ（仮）](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAICAIAAABsw6g0AAAAdElEQVR4nK3MAQbAIBQA0H/sjERiYiKRyEhkJGYkEokutkv8d4AHhJDjOCiljDHOuRDiPE8p5XVdSimttTHGWuuc897f9x1CiDGmlJ7nyTmXUt73/b4PUJZaK6AsrTVAWXrvgLKMMQBlmXMCyrLWApRl7/0DFiBh4FQCRpUAAAAASUVORK5CYII=)

---

# 料金プラン（仮）

| 項目 | Starter | **Business（推奨）** | Enterprise |
|---|---|---|---|
| 月額 / 人 | ¥500 | **¥900** | 個別見積 |
| 連携ソース | 3 | **無制限** | 無制限 |
| SSO | — | **○** | ○ |

Source: 価格は仮置き

---

# 導入スケジュール

<!-- step -->
### 1 カ月目
- 棚卸しと権限設計

<!-- step * -->
### 2〜3 カ月目
- パイロット運用

<!-- step -->
### 4 カ月目〜
- 全社展開

<!-- step -->
### 以降
- 四半期ごとに改善

---

# 次のステップ

- 11 月中: パイロット部門の選定
- 12 月: 試験運用キックオフ
- 連絡先: hubble-pj@example.com
