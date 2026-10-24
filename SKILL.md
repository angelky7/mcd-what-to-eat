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

1. `query-nearby-stores` —— 参数 `{"beType":1,"city":"<城市>","searchType":1}`，取 `data[0].storeCode`（到店自取）；用户要驾车就用 `beType=5`，此时后续调用必须带上 `beCode`。
2. `query-meals` —— 参数 `{"storeCode":"<门店>","beType":1,"orderType":1}`，返回 `data.categories[]` 分类与 `data.meals{}` 详情（`name`、`currentPrice`、`originalPrice`）。
3. `query-store-coupons` —— 参数同上，返回该门店可用券：`title`、`products[].productCode`、`tradeDateTime`。

辅助工具：`campaign-calendar`（当月活动）、`available-coupons` / `auto-bind-coupons`（领券）、`query-my-coupons`（我的券）、`calculate-price`（含优惠算价）。

## 执行方式

优先直接跑脚本，一步到位：

```bash
node src/plan.mjs <城市> <预算>
# 例：node src/plan.mjs 郑州市 30
```

输出形如：

```
门店：麦当劳××得来速餐厅（140XXXX）  在售餐品：125 款
推荐组合：酥脆无双套餐 ¥20 + 圆筒冰淇淋 ¥5
原价 ¥25｜实付 ¥25｜预算 30
可用券：1024“码”力翻倍（限 龙焰鸡腿堡两件套，至 2026-10-30）
```

需要自定义时按工具顺序手动调，再把数据整理成 `{ items, coupons }` 交给 `planCombo`，**不要手算**。

## 输出格式

固定四行：

- **门店**：门店名 + storeCode + 在售餐品数
- **推荐组合**：主食 + 小食 + 饮料，各自价格
- **价格**：原价 / 实付 / 预算，超预算要标明
- **可用券**：券名 + 适用商品 + 有效期，命中本单的标 ★

## 数据格式

`planCombo` 吃这个结构（字段见 `src/combo.mjs` 与 `test/combo.test.mjs`）：

```json
{
  "items": [{ "id": "9900014838", "name": "巨无霸", "price": 24, "category": "main" }],
  "coupons": [{ "id": "c1", "name": "巨无霸免费兑换券", "type": "free_item", "target": "9900014838" }]
}
```

`category` 只认 `main` / `side` / `drink`；券的 `type` 只认 `free_item` / `percent_off` / `threshold_off`。
