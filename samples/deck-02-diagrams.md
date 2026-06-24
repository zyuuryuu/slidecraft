<!-- slide: Title.1Title.Single -->
# 図解デッキ — ダイアグラム編集テスト
## flowchart / sequence をネイティブ編集

Category: DIAGRAM TEST
Date: 2026-06-24 | SlideCraft
Footer: YAML / JSON / Mermaid 切替の動作確認用

---

# システム構成（flowchart・アイコン）
> ノードにアイコン、TB方向

```diagram
type: flowchart
direction: TB
title: Web三層構成
nodes:
  - id: client
    label: ブラウザ
    shape: rounded_rect
    icon: client
  - id: lb
    label: ロードバランサ
    icon: load_balancer
  - id: web
    label: Webサーバ
    icon: server
  - id: db
    label: データベース
    shape: rounded_rect
    icon: database
edges:
  - from: client
    to: lb
    label: "HTTPS"
  - from: lb
    to: web
  - from: web
    to: db
    label: "SQL"
```

---

# データ処理パイプライン（flowchart・LR）
> 左→右の流れ

```diagram
type: flowchart
direction: LR
title: ETL パイプライン
nodes:
  - id: src
    label: ソース
    shape: rounded_rect
  - id: ext
    label: 抽出
  - id: tr
    label: 変換
  - id: load
    label: ロード
  - id: dw
    label: データ基盤
    shape: rounded_rect
    icon: database
edges:
  - from: src
    to: ext
  - from: ext
    to: tr
  - from: tr
    to: load
  - from: load
    to: dw
```

---

# 申請の承認フロー（flowchart・分岐）
> diamond で条件分岐

```diagram
type: flowchart
direction: TB
title: 承認フロー
nodes:
  - id: start
    label: 申請
    shape: rounded_rect
  - id: check
    label: 金額判定
    shape: diamond
  - id: mgr
    label: 課長承認
  - id: dir
    label: 部長承認
  - id: done
    label: 完了
    shape: rounded_rect
edges:
  - from: start
    to: check
  - from: check
    to: mgr
    label: "10万未満"
  - from: check
    to: dir
    label: "10万以上"
  - from: mgr
    to: done
  - from: dir
    to: done
```

---

# API リクエスト（sequence）
> 参加者とメッセージの往復

```diagram
type: sequence
direction: TB
title: 決済リクエスト
nodes:
  - id: user
    label: ユーザー
  - id: api
    label: API
  - id: pay
    label: 決済サービス
  - id: db
    label: DB
edges:
  - from: user
    to: api
    label: "注文確定"
  - from: api
    to: pay
    label: "与信照会"
  - from: pay
    to: api
    label: "OK"
    style:
      dash: true
  - from: api
    to: db
    label: "保存"
  - from: api
    to: user
    label: "完了通知"
    style:
      dash: true
```

---

# マイクロサービス構成（flowchart・グループ）
> groups でサブグラフ化

```diagram
type: flowchart
direction: TB
title: サービス境界
nodes:
  - id: gw
    label: API Gateway
    icon: load_balancer
  - id: order
    label: 注文サービス
    icon: server
    group: core
  - id: inv
    label: 在庫サービス
    icon: server
    group: core
  - id: odb
    label: 注文DB
    shape: rounded_rect
    icon: database
    group: data
  - id: idb
    label: 在庫DB
    shape: rounded_rect
    icon: database
    group: data
groups:
  - id: core
    label: コアサービス
  - id: data
    label: データ層
edges:
  - from: gw
    to: order
  - from: gw
    to: inv
  - from: order
    to: odb
  - from: inv
    to: idb
  - from: order
    to: inv
    label: "在庫引当"
    style:
      dash: true
```

---

<!-- slide: Closing.1Message.Single -->
# 各図で YAML / JSON / Mermaid を切り替えて確認
> Edit モードのフォーム編集も併せてテスト
