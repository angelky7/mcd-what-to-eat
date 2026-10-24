# 麦麦吃什么 · mcd-what-to-eat

[![Release](https://img.shields.io/github/v/release/caob23/mcd-what-to-eat)](https://github.com/caob23/mcd-what-to-eat/releases/latest)
[![Stars](https://img.shields.io/github/stars/caob23/mcd-what-to-eat)](https://github.com/caob23/mcd-what-to-eat/stargazers)
[![License](https://img.shields.io/github/license/caob23/mcd-what-to-eat)](./LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D20.12-green)
![McDonald's MCP](https://img.shields.io/badge/McDonald%27s%20MCP-mcd--mcp%201.0.0-red)

一个 WorkBuddy Skill：**先算预算，再选券，最后推荐组合**。它不猜价格、不背菜单，门店、餐品、券和活动全部通过麦当劳 MCP 实时取，再用一个确定性的组合器算出「预算内、用掉最划算那张券」的点餐方案。

麦当劳程序员创意开发大赛参赛作品（MCP 集成说明见 [MCP_INTEGRATION.md](./MCP_INTEGRATION.md)，参赛声明见 [CONTEST_DECLARATION.md](./CONTEST_DECLARATION.md)）。

## 目标用户

- **预算敏感的点餐决策者**：站在菜单前不知道 30 块能吃到什么，希望一次得到「主食+小食+饮料」的完整方案而不是随机单品；
- **手里有券不知怎么用的人**：满减、折扣、免费兑换混在一起，不知道该用哪张、用在哪；
- **WorkBuddy / MCP 用户**：不想装 App、开小程序，在对话框里问一句「预算 30，国贸附近，不吃辣」就能拿到带价格明细的推荐。

## 使用的麦当劳 MCP 能力

- MCP Server：`https://mcp.mcd.cn`（streamable HTTP，`Authorization: Bearer <MCP_TOKEN>`），实测服务端 `mcd-mcp 1.0.0`，共 35 个工具。
- 本 Skill 实际调用的三个工具（`src/plan.mjs`）：

| 工具 | 传参 | 用途 |
| --- | --- | --- |
| `query-nearby-stores` | `beType=1`（到店自取）、`city`、`keyword`、`searchType=2` | 拿到可点餐门店的 `storeCode` 与预约时段 |
| `query-meals` | `storeCode`、`beType=1`、`orderType=1` | 拉全部分类菜单与实时价格（实测单店 91–124 款在售） |
| `query-store-coupons` | `storeCode`、`beType=1`、`orderType=1` | 该门店可用券、适用商品编码、有效期 |

> `searchType` 的语义容易踩坑：**`searchType=2` 才是按地点搜索（必须带 `keyword`）**，`searchType=1` 只搜「收藏餐厅」并直接忽略 `city`。用 1 去查城市会稳定返回账号收藏的那家店（实测传「北京市」返回佛山门店），看起来一切正常、结果却是错的。

- 其余可用能力（未在主流程使用，`npm run tools` 可查全部 35 个）：`available-coupons` / `auto-bind-coupons`（领券）、`campaign-calendar`（活动日历）、`calculate-price`（含优惠算价）、`create-order`（下单，本 Skill 不下单）。

## 真实运行结果

```bash
$ node src/plan.mjs 北京市 30
门店：麦当劳北京前门西街餐厅（1950212）  在售餐品：91 款
推荐组合：牛肉堡单品精选 ¥15.5 + 圆筒冰淇淋 ¥5 + 纯悦 ¥9
原价 ¥29.5｜实付 ¥29.5｜预算 30
可用券：当前门店未查到匹配的券
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

持有可本地计算的券时，组合器会把该商品选进组合：

```bash
$ npm run demo
推荐组合：巨无霸 ¥24 + 小薯 ¥7 + 纯水 ¥4
原价 ¥35｜券 -¥24（巨无霸免费兑换券）｜实付 ¥11｜预算 30
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

`src/combo.mjs` 的 `planCombo(menu, coupons, budget, { prefer })` 做一次**券感知的组合搜索**：

1. 主食 / 小食 / 饮料各取 top-3 候选（`prefer` 命中的优先，例如套餐、薯条、可乐，再按价格升序），并额外保底纳入全球最便宜的商品与免费兑换券指定的商品——偏好项超预算时枚举仍能找到预算内的便宜替代，有券也不会选不到那个菜；
2. 按「完整组合 → 依次砍掉饮料 → 再砍小食」的前缀顺序枚举，对每个候选组合计算每张券能省多少，取省得最多的一张（免费兑换、折扣、满减三类都支持）；
3. 采用第一个能塞进预算的前缀；同前缀内先比「搭配意图命中数」（套餐、薯条、可乐这类完整搭配优先），再比实付、再比省下的金额；
4. 输出组合、用掉的券、省下金额、实付与是否超预算。

`src/plan.mjs` 负责线上部分：取门店 → 拉菜单并归类 → 取门店券并映射为内部券结构 → 交给组合器 → 输出四行结论。

**菜单归类以商品名为主信号、分类名兜底**，因为真实菜单里有三类干扰：`人气热卖` 是跨分类营销位（同一商品会在聚合位和真实分类各出现一次，按分类去重会把薯饼、炸鸡带进主食）；丝巾、水手帽、毛绒周边、玩具袋、3 元蘸酱等非餐品混在菜单里；`小食拼盘/多人餐` 实为双人分享餐而非小食。这些都在 `normalizeMenu()` / `categoryOf()` 里显式处理。

官方 MCP 未公布优惠券响应体字段文档，`couponsFor()` 采用「结构化字段优先、中文标题语义兜底」的双层映射，映射不出的券交给 `calculate-price` 试算，仍算不出就只展示、不参与计算，不编造优惠金额（详见 [MCP_INTEGRATION.md](./MCP_INTEGRATION.md)）。

## 项目结构

```
README.md              项目介绍、安装方法、使用示例、目标用户
SKILL.md               技能定义与工作流程（WorkBuddy 读取）
MCP_INTEGRATION.md     麦当劳 MCP Server / Tool / 调用流程 / 业务价值说明
CONTEST_DECLARATION.md 参赛声明（与官方模板逐字一致）
src/mcp.mjs            MCP streamable HTTP 客户端 + CLI（ping / list / call）
src/plan.mjs           线上主流程：门店 → 菜单 → 券 → 组合
src/combo.mjs          确定性组合与优惠计算
examples/menu.json     离线演示数据
test/                  组合器与线上流程映射的单元测试
mcp-config.example.json  连接器配置模板（仅环境变量占位符）
workbuddy.md           WorkBuddy 开发对话上下文导出
```

## 测试

```bash
npm test
```

纯离线、零依赖，只用 Node 内置模块（`node:test`、`fetch`），要求 Node >= 20.12（`process.loadEnvFile` 自该版本起可用；更早版本请自行导出 `MCD_MCP_TOKEN` 环境变量）。

## License

MIT
