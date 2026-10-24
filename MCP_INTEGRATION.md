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

主流程固定调用三个工具（见 `src/plan.mjs`）：

| Tool | 传参 | 用途 |
| --- | --- | --- |
| `query-nearby-stores` | `beType=1`（到店自取）、`city`、`keyword`、`searchType=2` | 拿到可点餐门店的 `storeCode`；驾车场景可用 `beType=5`（需带 `beCode`） |
| `query-meals` | `storeCode`、`beType=1`、`orderType=1` | 拉取全部分类菜单与实时价格（`data.categories[]` + `data.meals{}`） |
| `query-store-coupons` | `storeCode`、`beType=1`、`orderType=1` | 拉取该门店当前可用券（`title`、`products[].productCode`、`tradeDateTime`） |
| `calculate-price` | `storeCode`、`beType=1`、`orderType=1`、`items[].productCode/quantity/couponId/couponCode` | 活动券无法本地计算优惠时，挂券试算真实应付价（`data.price` 单位：分） |

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
planCombo() ──► 券感知的组合搜索：前缀枚举 × 每类 top-K 候选 × 每张券，
   │            输出「预算内、用掉最划算那张券」的组合
   ▼
calculate-price（可选）──► 活动券本地算不出优惠时挂券试算，更省则采用
   ▼
四行结论：门店 / 推荐组合 / 价格（原价·券优惠·实付·预算）/ 可用券
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

## 业务价值

到店或点外卖时的真实困难是：菜单几十款、券分满减/折扣/免费兑换多种，「30 块能吃到什么、手里三张券该用哪张」人工比较成本很高。本项目把实时菜单、门店券和预算交给确定性组合器，一次给出组合结论与省钱明细——**先算预算，再选券，最后推荐组合**，且所有价格、餐品、券面信息一律来自 MCP 实时返回，不猜价格、不背菜单。

## 安全与合规

- 仓库内不含任何真实 Token：`mcp-config.example.json` 仅使用环境变量占位符 `${MCD_MCP_TOKEN}`，`.env` 已被 `.gitignore` 排除；
- 项目输出仅供参考，餐品信息、价格及供应状态以麦当劳官方渠道实时结果为准；
- 参赛声明见 [CONTEST_DECLARATION.md](./CONTEST_DECLARATION.md)（内容与官方模板逐字一致，未做修改）。
