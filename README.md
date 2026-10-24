# 麦麦吃什么 · mcd-what-to-eat

[![Release](https://img.shields.io/github/v/release/angelky7/mcd-what-to-eat)](https://github.com/angelky7/mcd-what-to-eat/releases/latest)
[![Stars](https://img.shields.io/github/stars/angelky7/mcd-what-to-eat)](https://github.com/angelky7/mcd-what-to-eat/stargazers)
[![License](https://img.shields.io/github/license/angelky7/mcd-what-to-eat)](./LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D20.12-green)
![McDonald's MCP](https://img.shields.io/badge/McDonald%27s%20MCP-mcd--mcp%201.0.0-red)

一个 WorkBuddy Skill：**先算预算，再选券，最后推荐组合**。它不猜价格、不背菜单，门店、餐品、券和活动全部通过麦当劳 MCP 实时取，再用一个确定性的组合器算出「预算内、用掉最划算那张券」的点餐方案。

麦当劳程序员创意开发大赛参赛作品（MCP 集成说明见 [MCP_INTEGRATION.md](./MCP_INTEGRATION.md)，参赛声明见 [CONTEST_DECLARATION.md](./CONTEST_DECLARATION.md)）。

## 在线 Demo

**<https://angelky7.github.io/mcd-what-to-eat/>** —— 打开即用，不用配 Token、不用装环境。

Demo 用的是**脱敏快照**（北京 · 前门、上海 · 黄浦两家门店的当日菜单 + 官方热量，已去掉 `storeCode` / `couponCode`），组合器与线上是同一份代码：`docs/core/combo-core.mjs` 是 `src/core/combo-core.mjs` 的同步副本，`npm test` 会断言两者逐字节一致，因此不存在「Demo 一套逻辑、线上另一套逻辑」。

> 关于券：真实门店券的响应体只有标题和时间，不含类型与金额，本地算不出优惠（线上靠 `calculate-price` 试算）。Demo 没有网络，所以额外放了 3 张**明确标注「虚构」的演示券**（免费兑换、满 25 减 5、全场 9 折），只用来演示用券计算，页面上会写明「虚构的演示券」，不和真实券混为一谈。

| 能试什么 | 说明 |
| --- | --- |
| 换门店 | 北京 · 前门 / 上海 · 黄浦，两家的菜单和券都不一样 |
| 预算滑杆 | ¥10–80，另附 ¥15 / 20 / 30 / 50 快捷档 |
| 优化目标 | 最省 / 最顶饱 / 每元热量最高 |
| 用券策略 | 自动挑券 / 不用券；每张券还能单独停用 |
| 必须包含 | 主食 / 小食 / 饮品，可多选 |
| 忌口 | 逗号分隔关键词，如 `辣,牛肉` |
| **换单品** | 方案里的套餐（随心配、三件套、带杯型的饮料）可以换单品，价格和热量实时跟着变 |
| 粘贴自己的 JSON | 换成你手上真实门店的菜单数据，纯前端本地计算 |

页面无框架、无 CDN、无构建步骤，`docs/` 目录直接丢到任何静态托管就能跑。本地预览：

```bash
npm run demo:serve      # http://127.0.0.1:8080/
```

## 目标用户

- **预算敏感的点餐决策者**：站在菜单前不知道 30 块能吃到什么，希望一次得到「主食+小食+饮料」的完整方案而不是随机单品；
- **手里有券不知怎么用的人**：满减、折扣、免费兑换混在一起，不知道该用哪张、用在哪；
- **WorkBuddy / MCP 用户**：不想装 App、开小程序，在对话框里问一句「预算 30，国贸附近，不吃辣」就能拿到带价格明细的推荐。

## 使用的麦当劳 MCP 能力

- MCP Server：`https://mcp.mcd.cn`（streamable HTTP，`Authorization: Bearer <MCP_TOKEN>`），实测服务端 `mcd-mcp 1.0.0`，共 35 个工具。
- 本 Skill 实际调用的工具（`src/plan.mjs`）：

| 工具 | 传参 | 用途 |
| --- | --- | --- |
| `query-nearby-stores` | `beType=1`（到店自取）、`city`、`keyword`、`searchType=2` | 拿到可点餐门店的 `storeCode` 与预约时段 |
| `query-meals` | `storeCode`、`beType=1`、`orderType=1` | 拉全部分类菜单与实时价格（实测单店 91–124 款在售） |
| `query-store-coupons` | `storeCode`、`beType=1`、`orderType=1` | 该门店可用券、适用商品编码、有效期 |
| `list-nutrition-foods` | `{}` | 官方单品营养表，作为热量数据源 |
| `query-meal-detail` | `{"code":"<productCode>"}`（参数名是 `code`） | 套餐的 `rounds[]` 子项构成，用于累加套餐热量 |

- 另有**非 MCP** 的官方热量源：麦当劳官网的[营养计算器](https://www.mcdonalds.com.cn/nutrition_calculator)，页面把 137 条商品营养数据内嵌在 `var raw_data = {...}` 里，无需登录。`npm run nutrition:fetch` 抓成 `data/nutrition-calculator.json`，补上 `list-nutrition-foods` 缺的麦咖啡、雪冰、早餐与小/中/大杯规格。抓取脚本只读这一份公开网页数据，不含任何 Token。

> `searchType` 的语义容易踩坑：**`searchType=2` 才是按地点搜索（必须带 `keyword`）**，`searchType=1` 只搜「收藏餐厅」并直接忽略 `city`。用 1 去查城市会稳定返回账号收藏的那家店（实测传「北京市」返回佛山门店），看起来一切正常、结果却是错的。

- 其余可用能力（未在主流程使用，`npm run tools` 可查全部 35 个）：`available-coupons` / `auto-bind-coupons`（领券）、`campaign-calendar`（活动日历）、`calculate-price`（含优惠算价）、`create-order`（下单，本 Skill 不下单）。

## 真实运行结果

```bash
$ node src/plan.mjs 北京市 30
门店：麦当劳北京前门西街餐厅（1950212）  在售餐品：91 款
推荐组合：牛肉堡单品精选 ¥15.5 + 圆筒冰淇淋 ¥5 + 纯悦 ¥9
原价 ¥29.5｜实付 ¥29.5｜预算 30
热量：合计 341 kcal（1 件热量未知，未计入）
可用券：当前门店未查到匹配的券
```

换个优化目标，「最顶饱」会真的去比热量（套餐热量由子项累加）：

```bash
$ node src/plan.mjs 北京市 30 国贸 --optimize=calories
门店：麦当劳北京建外SOHO(A座)餐厅（1950564）  在售餐品：107 款
推荐组合：麦乐鸡套餐 ¥25 + 圆筒冰淇淋 ¥5
原价 ¥30｜实付 ¥30｜预算 30｜目标 最顶饱
热量：合计 742 kcal（全部商品均有官方热量数据）
可用券：当前门店未查到匹配的券
提示：「最顶饱」只比较有官方热量的 26 款餐品，其余商品热量未知、不参与比较
```

```bash
$ node src/plan.mjs 北京市 25 国贸      # 城市 + 预算 + 地点关键词
门店：麦当劳北京建外SOHO(A座)餐厅（1950564）  在售餐品：100 款
推荐组合：精选超值随心配 ¥13.9 + 圆筒冰淇淋 ¥5
原价 ¥18.9｜实付 ¥18.9｜预算 25
可用券：当前门店未查到匹配的券
```

券的优惠算不出来时会退化成展示，并明确标注原因（目标商品下架/未上架时不能假装能用）：

```bash
门店：麦当劳佛山松岗桃园三路得来速餐厅（1400232）  在售餐品：124 款
推荐组合：精选超值随心配 ¥13.9 + 圆筒冰淇淋 ¥5 + 纯悦 ¥7.5
原价 ¥26.4｜实付 ¥26.4｜预算 30
可用券：1024“码”力翻倍（限 龙焰鸡腿堡两件套，至 2026-10-30｜目标商品本店未在售）
```

持有可本地计算的券时，组合器会把该商品选进组合；想看「不用券差多少」就加 `--no-coupon`：

```bash
$ npm run demo
推荐组合：巨无霸 ¥24 + 小薯条 ¥7 + 纯水 ¥4
原价 ¥35｜券 -¥24（巨无霸免费兑换券）｜实付 ¥11｜预算 30
热量：合计 723 kcal（1 件热量未知，未计入）
注意：为用这张券多花 ¥9，券省 ¥24，净省 ¥15

$ node src/combo.mjs examples/menu.json 30 --no-coupon
推荐组合：麦香鸡 ¥15 + 小薯条 ¥7 + 纯水 ¥4
原价 ¥26｜实付 ¥26｜预算 30
热量：合计 579 kcal（1 件热量未知，未计入）
注意：另有 3 张券可用，最划算那张能省 ¥3（已按你的设置忽略）

$ node src/combo.mjs examples/menu.json 30 --optimize=calories
推荐组合：巨无霸 ¥24 + 中薯条 ¥11 + 可乐中杯 ¥9×2
原价 ¥53｜券 -¥24（巨无霸免费兑换券）｜实付 ¥29｜预算 30｜目标 calories
热量：合计 1096 kcal（全部商品均有官方热量数据）
备选：巨无霸 ¥24 + 小薯条 ¥7 + 可乐中杯 ¥9 — ¥16
提示：「最顶饱」只比较有官方热量的 5 款餐品，其余商品热量未知、不参与比较
注意：为拿到更多热量多花 ¥24，券省 ¥24；想省钱可看备选里的「最省」
```

> 上例为离线示例数据。真实活动中「1024码力翻倍」这类活动券的响应体不含类型/金额字段，本地算不出优惠，此时主流程会用官方 `calculate-price` 挂券试算，试算不通才降级为仅展示。

## 它解决什么问题

到店或点外卖时，困难的是「30 块能吃到什么、手里三张券该用哪张」：菜单几十款、券有满减有折扣有免费兑换，人工比较很费劲。这个 Skill 把菜单、券、预算丢进组合器，一次给出结论和明细。

## 快速开始

1. 到 [麦当劳 MCP 平台](https://open.mcd.cn/mcp) 注册开发者账号，拿到 Token。
2. 配置环境变量：

   ```bash
   cp .env.example .env    # Windows: copy .env.example .env
   # 编辑 .env，填入 MCD_MCP_TOKEN
   ```

3. 验证连接并查看能力：

   ```bash
   npm run ping     # 打印服务端名称/版本
   npm run tools    # 打印全部工具名、说明、参数
   ```

4. 跑主流程（真实调用三个 MCP 工具）：

   ```bash
   node src/plan.mjs 北京市 30        # 城市、预算
   node src/plan.mjs 北京市 30 国贸    # 城市、预算、地点关键词（可选，定位更准）
   ```

5. 离线跑一遍组合器（不需要网络，数据来自 `examples/menu.json`）：

   ```bash
   npm run demo
   ```

## 在 WorkBuddy 里使用

左上角「专家 - 技能 - 连接器」→ 自定义连接器 → 添加 MCP，粘贴 [`mcp-config.example.json`](./mcp-config.example.json) 的内容（将 `${MCD_MCP_TOKEN}` 替换为实际 Token，或改用环境变量注入），保存后连接成功；再把 `SKILL.md` 里的技能说明作为技能导入（或直接把 `SKILL.md` 放进技能目录），对话里问「预算 30，国贸附近，不吃辣」即可。

## 组合器怎么算

`planCombo(menu, coupons, budget, options)` 做一次**券感知的组合搜索**，纯函数、无 IO，浏览器与 Node 共用同一份实现（`src/core/combo-core.mjs`）：

1. 主食 / 小食 / 饮料各取 top-3 候选（`prefer` 命中的优先，例如套餐、薯条、可乐，再按 `optimize` 目标的排序），并额外保底纳入全球最便宜的商品与免费兑换券指定的商品——偏好项超预算时枚举仍能找到预算内的便宜替代，有券也不会选不到那个菜；
2. 按「完整组合 → 依次砍掉饮料 → 再砍小食」的前缀顺序枚举，对每个候选组合计算每张券能省多少，取省得最多的一张（免费兑换、折扣、满减三类都支持）；
3. 采用第一个能塞进预算的前缀；同前缀内先比「搭配意图命中数」（套餐、薯条、可乐这类完整搭配优先），再比实付、再比省下的金额；
4. 输出组合、用掉的券、省下金额、实付、不用券的 baseline，以及另外两种优化目标下的备选（最多 2 条，与当前方案重复的不列）。

### 参数

| 参数 | 取值 | 默认 | 作用 |
| --- | --- | --- | --- |
| `budget` | 数字 / `Infinity` | 必填 | 预算上限，`Infinity` 表示不限 |
| `prefer` | `(item) => boolean` | `() => false` | 搭配意图，命中的商品在同价位排序更靠前 |
| `optimize` | `cost` / `calories` / `value` | `cost` | 最省 / 最顶饱（热量最高）/ 每元热量最高 |
| `couponMode` | `auto` / `off` / `pick` | `auto` | 自动挑最划算 / 完全不用券 / 只用指定的那张 |
| `couponId` | 券 `id` 或券名 | — | `couponMode=pick` 时指定券，找不到会退回不用券并给出原因码 |
| `excludeCoupons` | `id[]` | `[]` | 临时排除某些券（例如今天不想吃那款） |
| `requireCategories` | `("main"\|"side"\|"drink")[]` | `[]` | 必须包含的品类，凑不出时降级并给 `REQUIRE_UNSATISFIED` |
| `picks` | `{itemId: {roundIndex: choiceCode}}` | `{}` | 套餐内已换好的单品（换过的套餐会被钉在方案里） |
| `pinItems` | `id[]` | `picks` 的键 | 必须出现在组合里的商品，放不下时给 `PIN_DROPPED` |
| `maxItems` | 正整数 | `4` | 组合最多几件 |
| `maxPerItem` | 正整数 | `2` | 同一商品最多点几份 |
| `today` | `YYYY-MM-DD` | — | 计算券有效期用的「今天」，便于测试 |

### 热量怎么来（`src/nutrition.mjs`）

不维护本地热量表，全部来自官方，分四级降级——**每一级都记下来源，估算一定带 `≈`**：

| 级别 | 来源 | 说明 |
| --- | --- | --- |
| 1 | `list-nutrition-foods` | 官方接口，154 项，但用**单品名** |
| 2 | [官网营养计算器](https://www.mcdonalds.com.cn/nutrition_calculator) | 页面内嵌 137 条数据（含麦咖啡、雪冰、早餐、小/中/大杯），`scripts/fetch-nutrition-calculator.mjs` 抓成 `data/nutrition-calculator.json` |
| 3 | `query-meal-detail` 的 `rounds[]` | 套餐按默认子项累加，见下 |
| 4 | 同类推算 | 前三级都查不到的单品，按「同品类 + 同形态」的官方条目中位数推算，输出 `≈` |

菜单名比营养表粗是常态：菜单写「薯条」「可乐」「麦辣鸡翅」，营养表写「中薯条」「可乐中杯」「麦辣鸡翅-2块」。所以第 1、2 级之间有一层**规格对齐**：拆出 `小/中/大/迷你` 前后缀、去掉 `-` 与括号、按 `1个 / 1份 / 5块` 这类分量词归并，再按「显式规格 → 默认规格（薯条按中份、玉米杯按小份）→ 整份条目」的顺序取值。映射不出来就当作查不到，不做前缀模糊匹配——套餐名包含单品名，但套餐热量不是单品热量。

**套餐热量 = 默认子项之和**，`query-meal-detail` 的 `data.rounds[]` 每轮取 `isDefault=1` 的选项（`quantity>0` 时再取 `choices[0]`），逐个查热量后相加：

```
精选单人餐三件套
  板烧鸡腿堡   391 kcal
  中薯条       289 kcal
  可乐中杯     147 kcal
  ─────────────────────
  合计         827 kcal
```

规则边界（都有测试锁住）：

- **任一子项查不到就整单记未知**，不做部分累加——只把查得到的加起来会系统性低估套餐热量，比「未知」更误导；
- **组合类一律不做同类推算**：`套餐 / 件套 / 随心 / 拼盘 / 分享餐 / 双人 / 十翅 / 四宫格 …` 这些名字一律不推。把「精选单人餐三件套」按一个汉堡的 485 kcal 推算，比标「未知」错得多；
- **饮用水记 0**：`纯悦 / 饮用水 / 矿泉水` 即便两个源都没收录，热量就是 0，按饮料中位数推会得到 105 kcal，明显荒谬；
- 估算值**不参与**「最顶饱 / 最划算」的排序（`kcalSource === "estimate"` 会被排除），只参与「最省」时的展示。

### 随心配这类套餐可以换单品

「精选超值随心配」不是一份固定餐，而是「蓝区选 1 + 粉区选 1」，每一轮都能换，换了按 `diffPrice` 补差价。这些信息本来就在 `query-meal-detail` 的 `rounds[].choices[]` 里（`code` / `name` / `diffPrice` / `isDefault`），只是没人用它。

`resolveCombo(item, picks)` 把「某一套选择」折算成实际价格与热量，`planCombo(..., { picks })` 在搜索前先用 `applyPicks()` 写回菜单，所以换完之后排序、预算判断、券计算全都跟着变。两条边界：

- **换成一个查不到热量的选项时，这份套餐的热量变成「未知」**，不能拿换之前那个数字冒充新选择；
- **换过的套餐会被钉在方案里**（`pinItems`），不会因为优化器重排就消失；预算实在放不下才退回，并输出 `PIN_DROPPED` 说明原因。

### 为什么热量目标要收缩候选集

即便补齐了两个官方源，仍有约 7% 的菜单项（主要是没有构成数据的新品套餐、开心乐园餐）既查不到也推不出。把未知当 0 会让「最顶饱」系统性偏向恰好有数据的商品，等于给错建议；所以 `optimize !== "cost"` 时显式只比较有可信热量的餐品，并输出 `CALORIE_SUBSET` 说明「本次只在 N 款餐品里比较」。

### 绝不会悄悄变贵

用券方案的总价可能高于「最优不用券方案」，原因有两类：为了够门槛而凑单（原价被推高），或者券让「更大的一餐」变得可负担（件数变多）。处理方式按目标分开：

- **`cost`（最省）目标**：一旦发现用券方案比不用券方案更贵，直接改给不用券的答案，并输出 `CHEAPER_WITHOUT_COUPON` 说明「用券要 ¥X，比不用券的 ¥Y 更贵，已按不用券给你」。用户要的是省钱，不是把券用掉；
- **`calories` / `value` 目标**：多花的钱换的是更多热量、更高性价比，那正是目标本身，所以只报差价（`EXTRA_SPEND`：为拿到更多热量多花 ¥X，券省 ¥Y），不擅自降级，也不下「这张券不划算」的结论；
- 其余情况照常披露：`COUPON_NOT_WORTH_IT` / `EXTRA_SPEND_HIGH`（净亏，或多花的钱超过优惠额一半）、`CHEAPER_WITHOUT_COUPON`（「不用券 ¥A（3 件）比本方案 ¥B（5 件）便宜，差额主要来自件数」）。

固定种子的模糊测试（`test/core.test.mjs`，120 轮）会断言：用券方案要么更便宜，要么必须带上述披露码；另有专门用例锁住「满 25 减 5 凑单更贵 → 自动改用不用券方案」这条规则。

`src/plan.mjs` 负责线上部分：取门店 → 拉菜单并归类 → 取门店券并映射为内部券结构 → 交给组合器 → 输出四行结论。

**菜单归类以商品名为主信号、分类名兜底**，因为真实菜单里有三类干扰：`人气热卖` 是跨分类营销位（同一商品会在聚合位和真实分类各出现一次，按分类去重会把薯饼、炸鸡带进主食）；丝巾、水手帽、毛绒周边、玩具袋、3 元蘸酱等非餐品混在菜单里；`小食拼盘/多人餐` 实为双人分享餐而非小食。这些都在 `normalizeMenu()` / `categoryOf()` 里显式处理。

官方 MCP 未公布优惠券响应体字段文档，`couponsFor()` 采用「结构化字段优先、中文标题语义兜底」的双层映射，映射不出的券交给 `calculate-price` 试算，仍算不出就只展示、不参与计算，不编造优惠金额（详见 [MCP_INTEGRATION.md](./MCP_INTEGRATION.md)）。

## 已知的坑

都是实际调接口时撞出来的，写在这里省下重踩一遍的时间。

| 坑 | 现象 | 正确做法 |
| --- | --- | --- |
| `searchType` 语义 | 传 `1` + `city:"北京市"` 稳定返回**账号收藏的那家佛山店**，城市参数被忽略，结果错但看不出错 | 按地点搜索必须 `searchType=2` **且带 `keyword`**；搜不到才退回 `1` 并在输出注明「沿用收藏门店」 |
| `query-meal-detail` 参数名 | 传 `productCode` 报 `codemust not be blank` | 参数名是 `code` |
| 非餐品混入菜单 | 丝巾 ¥34.9、水手帽 ¥48.8、毛绒周边、玩具袋、3 元蘸酱 | `MERCH` 正则剔除 |
| 跨分类营销位 | 「人气热卖」13 件商品横跨套餐/小食/甜品/周边，同一商品在聚合位与真实分类各出现一次 | 归类以**商品名**为主，分类名只兜底 |
| 分类名有歧义 | 「小食拼盘/多人餐」「BFF四宫格」是分享餐不是小食；分类名里还有换行符 | 分享餐/套餐词优先于小食词 |
| 活动券无类型字段 | `query-store-coupons` 实测只返回 `title`/`couponId`/`couponCode`/`tradeDateTime`/`products`/`promotionId`，既没类型也没金额门槛 | 用 `calculate-price` 挂券试算真实应付价（`data.price` 单位是**分**），试算不通就降级为仅展示 |
| 套餐热量 | `list-nutrition-foods` 只有单品，套餐查不到 | 用 `query-meal-detail` 的 `rounds[]` 取默认子项热量累加 |
| 菜单名比营养表粗 | 菜单「薯条」「可乐」，营养表「中薯条」「可乐中杯」 | 规格前后缀 + 别名表对齐，见 `src/nutrition.mjs` |
| 0 千焦不等于没有数据 | 官网计算器里无糖可乐、纯悦的能量是 `0`，按 `kj <= 0` 过滤会整条丢掉，于是被当成「查不到」再去推算 | 解析时保留 `kj === 0` |
| 套餐被当成单品推算 | 一个「八件套」按一个汉堡的 485 kcal 估，比标未知更离谱 | 组合类（套餐/件套/爽/分享餐/四宫格…）一律不推算 |
| 随心配其实可以换 | 「精选超值随心配」在菜单里是个固定商品，但接口 `rounds[].choices[]` 里带着全部可换项与差价 | 建模成 `combo.rounds`，换单品后价格与热量重算 |
| 换单品后方案被换掉 | 换完某个套餐，优化器一重排就换成别的东西，用户会觉得「白点了」 | `picks` 的键自动成为 `pinItems`，钉住该商品；放不下才退回并给 `PIN_DROPPED` |
| 换了查不到热量的选项 | 直接沿用换之前的合计值，看起来正常但数字是旧的 | 换了就重算，算不全就记未知 |
| 周边混进菜单 | 「旋风星愿贴」¥3.9 这类贴纸/装扮也会出现在菜单和券适用清单里 | `MERCH` 补 `星愿贴` / `贴$` |
| JSON 解析 | MCP 响应里的 JSON 直接截断会报 `Unexpected non-whitespace character` | 用仓库里的 `extractJson()`，兼容 `text/event-stream` 与前后缀噪声 |

## 项目结构

```
README.md              项目介绍、在线 Demo、安装方法、算法与踩坑记录
SKILL.md               技能定义与工作流程（WorkBuddy 读取）
MCP_INTEGRATION.md     麦当劳 MCP Server / Tool / 调用流程 / 业务价值说明
CONTEST_DECLARATION.md 参赛声明（与官方模板逐字一致）
src/mcp.mjs            MCP streamable HTTP 客户端 + CLI（ping / list / call）
src/plan.mjs           线上主流程：门店 → 菜单 → 券 → 热量 → 组合
src/nutrition.mjs      热量解析：两个官方源的规格对齐 + 套餐子项累加 + 同类推算的边界
src/core/combo-core.mjs 纯计算核心：券感知组合搜索、套餐换单品（无 IO，浏览器可直接 import）
src/combo.mjs          组合器的 CLI 包装
data/nutrition-calculator.json  官网营养计算器快照（137 条，含热量，可重新抓取）
docs/                  在线 Demo（静态页，无框架无 CDN；core 为同步副本）
scripts/               抓官网营养数据、生成脱敏示例数据、同步 core、本地预览服务
examples/menu.json     离线演示数据
test/                  组合器 / 热量解析 / 换单品 / 模糊测试 / Demo 一致性测试
mcp-config.example.json  连接器配置模板（仅环境变量占位符）
workbuddy.md           WorkBuddy 开发对话上下文导出
```

## 测试

```bash
npm test
```

92 个用例，纯离线、零依赖，只用 Node 内置模块（`node:test`、`fetch`），要求 Node >= 20.12（`process.loadEnvFile` 自该版本起可用；更早版本请自行导出 `MCD_MCP_TOKEN` 环境变量）。

覆盖范围：

- `test/combo.test.mjs` / `test/core.test.mjs`：券类型计算、优化目标、baseline 对比、凑单披露、守卫（无主食 / 单一商品占额过半）、120 轮固定种子模糊测试、100ms 性能上限；
- `test/plan.test.mjs`：券字段双层映射、菜单归类、热量解析与套餐子项累加、忌口过滤、门店选择、券可用性标注；
- `test/nutrition.test.mjs`：规格对齐（薯条→中薯条、可乐大杯）、别名、官网计算器补充麦咖啡、组合类不推算、饮用水记 0、传旧 `Map` 时行为不变；
- `test/swap.test.mjs`：随心配换单品（差价、热量重算）、换成未知热量的选项不沿用旧值、换过的套餐被钉住、放不下时给 `PIN_DROPPED`；
- `test/demo.test.mjs`：`docs/core` 与 `src/core` 逐字节一致、页面不引 CDN、示例门店是北京/上海（不含佛山）、示例数据不含 `storeCode`/`couponCode`、热量来源合法、随心配带可换轮次、三种优化目标在 Demo 数据上都能出结果。

## License

MIT
