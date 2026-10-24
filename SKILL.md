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

主流程固定三步（问热量时再加两步，见下）：

1. `query-nearby-stores` —— 参数 `{"beType":1,"city":"<城市>","keyword":"<地点，可选>","searchType":2}`，取 `data[0].storeCode`（到店自取）；用户要驾车就用 `beType=5`，此时后续调用必须带上 `beCode`。
   ⚠️ `searchType` 必须传 **2**（按地点搜索）：传 1 只搜「收藏餐厅」且忽略 `city`，会稳定返回账号收藏的那家店，城市再对也没用。城市查询失败时才退回 `searchType=1` 并在输出里注明。
2. `query-meals` —— 参数 `{"storeCode":"<门店>","beType":1,"orderType":1}`，返回 `data.categories[]` 分类与 `data.meals{}` 详情（`name`、`currentPrice`、`originalPrice`）。
3. `query-store-coupons` —— 参数同上，返回该门店可用券：`title`、`products[].productCode`、`tradeDateTime`。

辅助工具：`campaign-calendar`（当月活动）、`available-coupons` / `auto-bind-coupons`（领券）、`query-my-coupons`（我的券）、`calculate-price`（含优惠算价，活动券算不出优惠时用它挂券试算）。

问热量 / 「哪个更顶饱」时再加两个：

4. `list-nutrition-foods` —— 拿官方单品营养表（`name,null,kJ,kcal,...` 逐行），按商品名建索引。
5. `query-meal-detail` —— 参数 `{"code":"<productCode>"}`（⚠️ 参数名是 `code`，不是 `productCode`），返回 `data.rounds[]` 子项构成。

**套餐热量由子项累加得出**：每轮取 `isDefault=1` 的默认选项（`quantity>0` 时再取 `choices[0]`），逐个查营养表后相加（例：板烧鸡腿堡 391 + 中薯条 289 + 可乐中杯 147 = 827 kcal）。**任一子项查不到就整单记未知，不做部分累加**——只加查得到的会系统性低估套餐热量，比「未知」更误导人。

## 执行方式

优先直接跑脚本，一步到位：

```bash
node src/plan.mjs <城市> <预算> [地点关键词] [选项...]
# 例：node src/plan.mjs 北京市 30
# 例：node src/plan.mjs 北京市 30 国贸
# 例：node src/plan.mjs 北京市 40 国贸 --optimize=calories   # 最顶饱
# 例：node src/plan.mjs 北京市 30 国贸 --no-coupon           # 看看不用券差多少
# 例：node src/plan.mjs 北京市 30 国贸 --coupon=巨无霸免费兑换券
```

选项（也可直接传给 `planCombo` 的 `options`）：

| 选项 | 取值 | 作用 |
| --- | --- | --- |
| `--optimize=` | `cost` / `calories` / `value` | 最省 / 最顶饱 / 每元热量最高，默认 `cost` |
| `--no-coupon` | — | 等价 `couponMode:"off"`，会额外告诉你「最划算那张券本可省多少」 |
| `--coupon=<id或券名>` | — | 只用指定的这张券，找不到会退回不用券并说明原因 |
| `excludeCoupons` | `id[]` | 临时排除某些券 |
| `requireCategories` | `main`/`side`/`drink` 数组 | 必须包含的品类，凑不出时降级并说明 |
| `maxItems` / `maxPerItem` | 整数 | 最多几件 / 同一商品最多几份（默认 4 / 2） |
| `today` | `YYYY-MM-DD` | 算券有效期用的「今天」，便于复现 |

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

固定四行（问到热量或「顶饱」时价格行下面多一行热量）：

- **门店**：门店名 + storeCode + 在售餐品数
- **推荐组合**：主食 + 小食 + 饮料，各自价格
- **价格**：原价 / 券优惠 / 实付 / 预算，超预算要标明 ⚠
- **热量**（可选）：`合计 827 kcal`，有子项查不到时写 `合计 341 kcal（1 件热量未知）`
- **可用券**：券名 + 适用商品 + 有效期，实际采用的标 ★已用，商品命中本单的标 ★匹配本单，目标商品本店未在售的要注明

**必须把 `notices` 转述给用户**，不能只念价格。这几个码直接关系到「这建议靠不靠谱」：

| 码 | 何时出现 | 怎么跟用户说 |
| --- | --- | --- |
| `COUPON_IGNORED` | `couponMode=off` 但确实有券可用 | 「你有 N 张券可用，最划算那张本可省 ¥X」 |
| `EXTRA_SPEND` | 为了用券多花了钱 | 「为用这张券多花 ¥X，券省 ¥Y，净省 ¥Z」；热量目标下是「为拿到更多热量多花」 |
| `COUPON_NOT_WORTH_IT` / `EXTRA_SPEND_HIGH` | 净亏，或多花超过优惠额一半（仅 `cost` 目标） | 明确说这张券不划算 |
| `CHEAPER_WITHOUT_COUPON` | 不用券更便宜 | `cost` 目标下已自动改成不用券方案，照实说「已按不用券给你」；热量目标下说清是件数不同 |
| `CALORIE_SUBSET` | 热量目标下只比较了有数据的那部分餐品 | 「只在 N 款有官方热量的餐品里比较」 |
| `ITEM_NOT_LISTED` / `COUPON_EXPIRED` / `THRESHOLD_NOT_MET` | 券用不了 | 说清是哪一条，别暗示能用 |
| `REQUIRE_UNSATISFIED` | 预算内凑不出必须含的品类 | 说清降级成了什么 |

需要自定义时按工具顺序手动调，再把数据整理成 `{ items, coupons }` 交给 `planCombo`，**不要手算**。

## 数据格式

`planCombo` 吃这个结构（字段见 `src/core/combo-core.mjs` 与 `test/core.test.mjs`）：

```json
{
  "items": [{ "id": "9900014838", "name": "巨无霸", "price": 24, "category": "main", "kcal": 497 }],
  "coupons": [{ "id": "c1", "name": "巨无霸免费兑换券", "type": "free_item", "target": "9900014838" }]
}
```

`category` 只认 `main` / `side` / `drink`；券的 `type` 只认 `free_item` / `percent_off` / `threshold_off`；`kcal` 拿不到就**不要填 0**，留 `null` / 不填，让它按「未知」处理。

