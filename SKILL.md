---
name: mcd-what-to-eat
description: 用麦当劳 MCP 能力推荐「今天吃什么 + 怎么点最省」。当用户问今天吃什么、预算有限怎么点、手里券该怎么用、想吃某类口味但不知道点哪款时使用。
---

# 麦麦吃什么（MCD What to Eat）

用麦当劳 MCP 拉到的真实门店、菜单、价格和券，给出**一套组合 + 一份省钱明细**。核心不是随机推荐，而是「预算内、用掉手上最划算的那张券」。

## 必须遵守

- 门店、餐品、价格、券面信息**一律来自 MCP 返回**，不得编造，也不要用记忆里的价格。
- 工具名和参数按下面固定的调法传，不要自造参数。
- 券只能用一张时，要说清「用了哪张、省了多少、剩下的还能干嘛」。
- 拿不到门店或菜单数据时直接说明缺什么，不要用示例数据凑答案。
- 只做推荐和算价，**不要调用 `create-order` 替用户下单**，除非用户明确说要下单。

## 可用工具（实测 mcd-mcp 1.0.0，共 35 个）

主流程固定三步：

1. `query-nearby-stores` —— 参数 `{"beType":1,"city":"<城市>","keyword":"<地点，可选>","searchType":2}`，取 `data[0].storeCode`（到店自取）；用户要驾车就用 `beType=5`，此时后续调用必须带上 `beCode`。
   ⚠️ `searchType` 必须传 **2**（按地点搜索）：传 1 只搜「收藏餐厅」且忽略 `city`，会稳定返回账号收藏的那家店，城市再对也没用。城市查询失败时才退回 `searchType=1` 并在输出里注明。
2. `query-meals` —— 参数 `{"storeCode":"<门店>","beType":1,"orderType":1}`，返回 `data.categories[]` 分类与 `data.meals{}` 详情（`name`、`currentPrice`、`originalPrice`）。
3. `query-store-coupons` —— 参数同上，返回该门店可用券：`title`、`products[].productCode`、`tradeDateTime`。

辅助工具：`campaign-calendar`（当月活动）、`available-coupons` / `auto-bind-coupons`（领券）、`query-my-coupons`（我的券）、`calculate-price`（含优惠算价，活动券算不出优惠时用它挂券试算）。

## 执行方式

优先直接跑脚本，一步到位：

```bash
node src/plan.mjs <城市> <预算> [地点关键词]
# 例：node src/plan.mjs 北京市 30
# 例：node src/plan.mjs 北京市 30 国贸
```

输出形如：

```
门店：麦当劳北京前门西街餐厅（1950212）  在售餐品：91 款
推荐组合：牛肉堡单品精选 ¥15.5 + 圆筒冰淇淋 ¥5 + 纯悦 ¥9
原价 ¥29.5｜实付 ¥29.5｜预算 30
可用券：当前门店未查到匹配的券
```

用到券时价格行会多出「券 -¥X（券名）」，可用券行把实际采用的那张标为「★已用」；券的目标商品本店没在售时，券行会追加「目标商品本店未在售」——这种券不能算优惠，也不要向用户暗示能用。

需要自定义时按工具顺序手动调，再把数据整理成 `{ items, coupons }` 交给 `planCombo`，**不要手算**。

## 输出格式

固定四行：

- **门店**：门店名 + storeCode + 在售餐品数
- **推荐组合**：主食 + 小食 + 饮料，各自价格
- **价格**：原价 / 券优惠 / 实付 / 预算，超预算要标明 ⚠
- **可用券**：券名 + 适用商品 + 有效期，实际采用的标 ★已用，商品命中本单的标 ★匹配本单，目标商品本店未在售的要注明

## 数据格式

`planCombo` 吃这个结构（字段见 `src/combo.mjs` 与 `test/combo.test.mjs`）：

```json
{
  "items": [{ "id": "9900014838", "name": "巨无霸", "price": 24, "category": "main" }],
  "coupons": [{ "id": "c1", "name": "巨无霸免费兑换券", "type": "free_item", "target": "9900014838" }]
}
```

`category` 只认 `main` / `side` / `drink`；券的 `type` 只认 `free_item` / `percent_off` / `threshold_off`。
