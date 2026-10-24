# MCP_INTEGRATION.md

本文档说明本项目实际使用的麦当劳 MCP Server、Tool、调用流程与业务价值。

## MCP Server

| 项 | 值 |
| --- | --- |
| Server 地址 | `https://mcp.mcd.cn` |
| 传输协议 | streamable HTTP |
| 鉴权方式 | `Authorization: Bearer <MCP_TOKEN>` |
| Token 申请 | <https://open.mcd.cn/mcp>（手机号验证登录 → 控制台 → 激活） |
| 服务端版本 | 实测 `mcd-mcp 1.0.0`，共 35 个工具 |
| 官方使用指南 | <https://github.com/M-China/mcd-mcp-server> |

## 实际使用的 Tool

主流程调用五个工具（见 `src/plan.mjs`）：

| Tool | 传参 | 用途 |
| --- | --- | --- |
| `query-nearby-stores` | `beType=1`（到店自取）、`city`、`keyword`、`searchType=2` | 拿到可点餐门店的 `storeCode`；驾车场景可用 `beType=5`（需带 `beCode`） |
| `query-meals` | `storeCode`、`beType=1`、`orderType=1` | 拉取全部分类菜单与实时价格（`data.categories[]` + `data.meals{}`） |
| `query-store-coupons` | `storeCode`、`beType=1`、`orderType=1` | 拉取该门店当前可用券（`title`、`products[].productCode`、`tradeDateTime`） |
| `calculate-price` | `storeCode`、`beType=1`、`orderType=1`、`items[].productCode/quantity/couponId/couponCode` | 活动券无法本地计算优惠时，挂券试算真实应付价（`data.price` 单位：分） |
| `list-nutrition-foods` | 无（或按分类页） | 官方单品营养表，逐行 `name,null,kJ,kcal,...`，作为热量数据源 |
| `query-meal-detail` | `{"code":"<productCode>"}` ⚠️ 参数名是 `code` | 返回 `data.rounds[]` 子项构成，用于把套餐热量按子项累加 |

> `searchType` 语义（实测）：`2` = 按地点搜索、必须带 `keyword`；`1` = 只搜「收藏餐厅」并忽略 `city`。用 `1` 查城市会稳定返回账号收藏的那家店（实测传「北京市」返回佛山门店），结果错但看不出错。因此城市查询走 `2`，搜不到才退回 `1` 并在输出里标注「沿用收藏门店」。

未在主流程使用但已核验存在的相关能力：`available-coupons` / `auto-bind-coupons`（领券）、`query-my-coupons`（我的券）、`campaign-calendar`（活动日历）、`create-order`（下单）。

> 合规边界：本项目**只做推荐与算价，不调用 `create-order`**，除非用户在对话中明确要求下单。

## 调用流程

```
initialize（MCP 握手）
   │
   ▼
query-nearby-stores(searchType=2) ──► 取 data[0].storeCode（到店自取）
   │                                  搜不到才退回 searchType=1（收藏门店）
   ▼
query-meals ──► normalizeMenu()：以商品名为主判、分类名兜底，
   │            归为主食/小食/饮料；剔除周边与非餐品；解析 currentPrice
   ▼
query-store-coupons ──► couponsFor()：映射为内部券结构
   │                   （结构化字段优先，标题语义兜底）
   │
   ▼
annotateAvailability() ──► 标注目标商品本店是否在售
   ▼
list-nutrition-foods ──► parseNutrition()：单品营养表 → Map<商品名, kcal>
   │
   ▼
enrichCalories() ──► 按名字给菜单项挂热量；套餐走 query-meal-detail，
   │                 rounds[] 默认子项热量累加（任一未知则整单 null）
   ▼
planCombo() ──► 券感知的组合搜索：前缀枚举 × 每类 top-K 候选 × 每张券，
   │            输出「预算内、用掉最划算那张券」的组合 + Top-3 备选
   ▼
对最终选中的组合补查热量（enrichCalories({ids})）
   ▼
calculate-price（可选）──► 活动券本地算不出优惠时挂券试算，更省则采用
   ▼
四行结论：门店 / 推荐组合 / 价格（原价·券优惠·实付·预算）/ 可用券（+ 热量行）
```

握手与传输层封装在 `src/mcp.mjs`：`initialize` → `notifications/initialized` → `tools/call`，同时兼容 `application/json` 与 `text/event-stream` 两种响应格式，`tools/list` 支持游标分页。

## 菜单归类的实测约束

真实菜单有三类干扰，只按分类名归类会算错，`categoryOf()` 因此以**商品名为主信号、分类名兜底**：

| 干扰 | 实测表现 | 处理 |
| --- | --- | --- |
| 跨分类营销位 | 「人气热卖」13 件商品横跨套餐/小食/甜品/饮品/周边，同一商品在聚合位与真实分类各出现一次 | 按商品名判定，不受去重顺序影响 |
| 非餐品混入菜单 | 丝巾 ¥34.9、水手帽 ¥48.8、毛绒周边 ¥24.9、玩具袋 ¥12、3 元蘸酱 | `MERCH` 正则剔除 |
| 分类名有歧义 | 「小食拼盘/多人餐」「BFF四宫格」是分享餐不是小食；分类名含换行符 | 分享餐/套餐词优先于小食词 |

## 优惠券字段映射说明

麦当劳官方未发布 `query-store-coupons` 的响应体字段文档，因此 `couponsFor()`（`src/plan.mjs`）采用**双层防御映射**：

1. **结构化字段优先**：读取 `couponType`/`type`/`preferentialType` 等类型字段与 `threshold`/`discountAmount`/`discount` 等数值字段（兼容多种命名）；
2. **中文标题语义兜底**：`「9 折」→ percent_off(10)`、`「满 20 减 3」→ threshold_off(20,3)`、`「立减 5 元」→ threshold_off(0,5)`、`「免费兑换券」→ free_item(target=products[0].productCode)`。

映射不出类型的券仍会出现在「可用券」展示行，但不参与价格计算（对未知类型记 0 优惠），保证不编造优惠金额。

实测线上券载荷**只有** `title`、`couponId`、`couponCode`、`tradeDateTime`、`products`、`promotionId` 六个字段，既无类型也无金额门槛——也就是说活动券（如「1024码力翻倍」）在本地完全算不出优惠。对这类券，主流程用官方 `calculate-price` 做**价格探针**：把券挂到其适用商品上试算，与不挂券的试算价对比得出真实节省，更省且在预算内才采用；试算不通（券不适用、目标商品未在售）就保持仅展示。

券的目标商品本店未在售时（例如「龙焰鸡腿堡两件套」下架，仅剩三件套/四件套），输出会标注「目标商品本店未在售」，不向用户暗示该券可用。

## 热量数据的取法

热量是**四级来源**（`src/nutrition.mjs`，每个餐品都带 `kcalSource` 告诉用户这数字哪来的），不编造、不静默兜底：

| 级别 | `kcalSource` | 数据来源 | 覆盖面（实测） |
| --- | --- | --- | --- |
| 1 | `mcp` | MCP `list-nutrition-foods`（`名称,null,kJ,kcal,...` → `parseNutrition()`） | 约 8–17% |
| 2 | `calculator` | 官网营养计算器 <https://www.mcdonalds.com.cn/nutrition_calculator> 的 `raw_data`（137 条，`kcal = kJ/4.184`），由 `npm run nutrition:fetch` 落到 `data/nutrition-calculator.json` | 约 20–27% |
| 3 | `composition` | `query-meal-detail` 的 `rounds[]` 子项热量累加 | 约 22–28% |
| 4 | `estimate` | 同名同形态 + 同品类中位数推算，页面标 `≈` | 约 32–38% |
| — | `definition` | 瓶装水按定义记 0（纯悦 / 饮用水 / 矿泉水） | 少量 |

要点：

1. **菜单名比营养表粗**（`薯条` vs `中薯条`），所以要先做规格对齐：`splitSize()` 拆出「迷你/小/中/大 + 杯/份/个」，再按「显式规格 → `1个`/`1份` 分量条目 → 中/小默认」的顺序挑变体（`pickVariant`）；别名表覆盖 `可乐→可口可乐`、`麦旋风→奥利奥麦旋风` 这类简称；
2. **套餐没有独立热量条目，用 `rounds[]` 子项累加**：

```
query-meal-detail {"code":"<精选单人餐三件套>", storeCode, beType, orderType}
  → data.rounds[]：每轮取 isDefault===1 的默认项，quantity>0 时再取 choices[0]
  → 板烧鸡腿堡 391 + 中薯条 289 + 可乐中杯 147 = 827 kcal
```

   ⚠️ 不传 `storeCode` 时线上会返回 `storeCode门店编码不能为空` 且 `rounds=[]`，看起来像「这个套餐没有构成」——其实只是没查成；
3. **任一子项查不到就整单记 `null`**，不做部分累加——部分累加会系统性低估套餐热量，比「未知」更容易误导用户（`test/plan.test.mjs` 里有对应用例锁住这个行为）；
4. **推算不越界**：名字里带 `套餐 / 随心配 / 分享餐 / 桶 / 拼盘 / 任选` 的直接拒绝推算，宁可返回未知也不给一个假数字；0 kJ 的条目（无糖可乐）是真实 0，不能被当成「查不到」；
5. 主流程对**最终选中的组合**会做一次定向补查（`enrichCalories(client, base, items, resolver, { ids })`），把「N 件热量未知」尽量压到 0。

热量类目标（`calories` / `value`）只在有热量的餐品子集里比较，并输出 `CALORIE_SUBSET` 说明——把未知当 0 会让优化系统性偏向恰好有数据的商品；`estimate` 级别的餐品**不参与**热量目标的排序，避免用推算值当锚点。

## 套餐换单品（随心配）

`query-meal-detail` 的 `rounds[].choices[]` 每项带 `code / name / diffPrice / isDefault / supportModify`，所以「随心配换一个单品」是纯本地计算：

- `resolveCombo(item, picks)`：`price = item.price - Σ默认项diffPrice + Σ选中项diffPrice`，`kcal = Σ选中项kcal`；
- 选中组合与默认不一致、且新选中的任一单品没有热量 → 整单 `kcal = undefined`（不复用旧总热量，避免换完还显示换前的数）；
- 换过的套餐会被 `pinItems` 钉住，优化器不会为了凑价把它换成别的商品；预算实在放不下时退回普通方案并给 `PIN_DROPPED`。

## 输出原因码

`planCombo` 的 `notices[]` 是一组 `{ code, message }`，给用户看的是 `message`，`code` 用于测试断言和上层做差异化处理。**不允许静默降级**：每一种「建议可能不靠谱」的情况都有对应码。

| code | 触发条件 |
| --- | --- |
| `COUPON_IGNORED` | 显式 `couponMode=off` 但存在可用券 |
| `COUPON_NOT_FOUND` | `couponMode=pick` 指定的券找不到 |
| `NOT_APPLICABLE` | 指定的券对当前组合不产生优惠 |
| `FIELD_MISSING` | 券响应缺类型/金额字段，或兑换券没指定商品 |
| `COUPON_EXPIRED` | 券已过期 |
| `THRESHOLD_NOT_MET` | 本单原价未达满减门槛 |
| `ITEM_NOT_LISTED` | 券的目标商品本店未在售 |
| `EXTRA_SPEND` / `EXTRA_SPEND_HIGH` / `COUPON_NOT_WORTH_IT` | 为用券凑单导致多花钱（后两个只在 `cost` 目标下出现，热量目标下多花钱是目标本身，不判「不划算」） |
| `CHEAPER_WITHOUT_COUPON` | 不用券方案更便宜：`cost` 目标下会**直接改用**不用券方案并说明原因；热量类目标下仅提示件数差异 |
| `CALORIE_SUBSET` | 热量目标下只在有官方热量的子集里比较 |
| `REQUIRE_UNSATISFIED` | 预算内凑不出「必须含某品类」 |
| `PIN_DROPPED` | 换过单品的套餐被预算挤掉，已退回未换的方案 |
| `SANITY_NO_STAPLE` / `SANITY_REPEAT_DOMINANT` | 组合没有主食 / 单一商品占了本单金额一半以上 |
| `NETWORK_ERROR` | 试算时接口失败，已降级为不含该券的结果 |

## 在线 Demo 与线上的一致性

<https://angelky7.github.io/mcd-what-to-eat/>

Demo 是静态页（`docs/`，GitHub Pages 托管，无框架无 CDN 无构建），但它**跑的是同一份组合器**：`docs/core/combo-core.mjs` 由 `npm run demo:sync` 从 `src/core/combo-core.mjs` 复制而来，`test/demo.test.mjs` 断言两者逐字节一致。Demo 的菜单数据是脱敏快照（去掉了 `storeCode` 与 `couponCode`），页面也不含任何 Token——所有计算都在浏览器本地完成，不发网络请求。

## 业务价值

到店或点外卖时的真实困难是：菜单几十款、券分满减/折扣/免费兑换多种，「30 块能吃到什么、手里三张券该用哪张」人工比较成本很高。本项目把实时菜单、门店券和预算交给确定性组合器，一次给出组合结论与省钱明细——**先算预算，再选券，最后推荐组合**，且所有价格、餐品、券面信息一律来自 MCP 实时返回，不猜价格、不背菜单。

## 安全与合规

- 仓库内不含任何真实 Token：`mcp-config.example.json` 仅使用环境变量占位符 `${MCD_MCP_TOKEN}`，`.env` 已被 `.gitignore` 排除；
- 项目输出仅供参考，餐品信息、价格及供应状态以麦当劳官方渠道实时结果为准；
- 参赛声明见 [CONTEST_DECLARATION.md](./CONTEST_DECLARATION.md)（内容与官方模板逐字一致，未做修改）。
