<!-- slide: Title.1Title.Single -->
# Mirai Flow
## 現場の段取りを、AIが自動で組み立てる

Category: PRODUCT PITCH
Date: 2026-06-24 | 株式会社ミライワークス
Footer: Confidential — 投資家向け資料

---

<!-- slide: Section.1Title.Single -->
# 課題と解決策
> The Problem & The Solution

---

# 現場は「段取り」に時間を奪われている
> Why Now

製造・物流・建設の現場では、作業計画の組み替えが日々発生し、その調整が属人化しています。

- 計画変更のたびに**平均2.5時間**の手戻りが発生
- 段取り業務の**68%**がベテラン1名に依存（属人化）
- 紙とExcelの併用で、最新情報がリアルタイムに共有されない
- 結果として、設備稼働率は理論値より**約15ポイント**低下

---

# Mirai Flow — 段取りを自動最適化するSaaS
> How It Works

現場データを取り込むと、AIが制約条件を考慮して最適な作業順序を自動生成します。

```diagram
type: flowchart
direction: LR
title: Mirai Flow 処理フロー
nodes:
  - id: input
    label: 現場データ取込
    shape: rounded_rect
    icon: client
  - id: engine
    label: 最適化エンジン
    icon: server
  - id: db
    label: 制約・実績DB
    shape: rounded_rect
    icon: database
  - id: plan
    label: 最適段取り出力
    shape: rounded_rect
    icon: cloud
edges:
  - from: input
    to: engine
    label: "取込"
  - from: engine
    to: db
    label: "参照"
  - from: engine
    to: plan
    label: "生成"
```

---

<!-- slide: Column.2Body.Equal -->
# 提供価値 — Before / After
> 導入前後の比較

<!-- col -->
**導入前（現状）**

- 段取り作成に毎日2.5時間
- ベテラン依存で属人化
- 紙・Excelで情報が分散
- 設備稼働率は理論値の85%
- 急な変更に弱い

<!-- col -->
**導入後（Mirai Flow）**

- 段取り自動生成で**5分**に短縮
- 誰でも同じ品質の計画を作成
- クラウドで全員が同じ最新情報
- 設備稼働率を**97%**まで改善
- 変更にも即時で再計画

---

# 市場機会
> TAM / SAM / SOM

国内の現場系SaaS市場は拡大を続けており、人手不足を背景に需要が加速しています。

```diagram
type: kpi
title: 市場規模と価格
kpi:
  cards:
    - value: "8,400億"
      label: 国内TAM
      delta: "+12%/年"
      trend: up
    - value: "1,200億"
      label: 想定SAM
      delta: "+18%/年"
      trend: up
    - value: "¥1,800"
      label: 月額/ユーザー
      delta: ""
      trend: up
nodes: []
edges: []
```

---

# 料金プラン
> Pricing（ネイティブ表）

| プラン | 月額/ユーザー | 拠点数 | サポート |
| --- | --- | --- | --- |
| Starter | ¥1,800 | 1拠点 | メール |
| Standard | ¥1,500 | 〜5拠点 | 優先メール・電話 |
| Enterprise | 要相談 | 無制限 | 専任CS・SLA保証 |

---

# 競合比較
> なぜ Mirai Flow が選ばれるのか

```diagram
type: radar
title: 競合比較（5段階評価）
radar:
  max: 5
  axes: ["導入容易性", "最適化精度", "価格", "サポート", "拡張性"]
  series:
    - name: Mirai Flow
      values: [5, 5, 4, 5, 4]
    - name: 既存大手A
      values: [2, 4, 2, 3, 5]
nodes: []
edges: []
```

---

# トラクションとロードマップ
> Traction & Roadmap

PoCを経て有償導入が立ち上がり、継続率も高水準を維持しています。

- 導入企業 **42社** / 解約率 月次 **1.2%**
- ARR **1.8億円**（前年比 +210%）
- 2026 Q3: 在庫連携API公開・パートナー開拓
- 2026 Q4: 多言語対応で東南アジア展開
- 2027 Q1: 予知保全モジュールをリリース

---

<!-- slide: Closing.1Message.Single -->
# 現場の段取りを、もっとなめらかに。
## Thank You

Category: CONTACT
Date: 代表取締役 佐藤 健一 | k.sato@miraiworks.example
Footer: 株式会社ミライワークス
