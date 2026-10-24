# 麦麦吃什么 · mcd-what-to-eat

[![Release](https://img.shields.io/github/v/release/caob23/mcd-what-to-eat)](https://github.com/caob23/mcd-what-to-eat/releases/latest)
[![Stars](https://img.shields.io/github/stars/caob23/mcd-what-to-eat)](https://github.com/caob23/mcd-what-to-eat/stargazers)
[![License](https://img.shields.io/github/license/caob23/mcd-what-to-eat)](./LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D%2018-green)
![McDonald's MCP](https://img.shields.io/badge/McDonald%27s%20MCP-mcd--mcp%201.0.0-red)

一个 WorkBuddy Skill：**先算预算，再选券，最后推荐组合**。它不猜价格、不背菜单，门店、餐品、券和活动全部通过麦当劳 MCP 实时取，再用一个确定性的组合器算出「预算内、用掉最划算那张券」的点餐方案。

## 使用的麦当劳 MCP 能力

- MCP Server：`https://mcp.mcd.cn`（streamable HTTP，`Authorization: Bearer <MCP_TOKEN>`），实测服务端 `mcd-mcp 1.0.0`，共 35 个工具。
- 本 Skill 实际调用的三个工具（`src/plan.mjs`）：

| 工具 | 传参 | 用途 |
| --- | --- | --- |
| `query-nearby-stores` | `beType=1`（到店自取）、`city`、`searchType=1` | 拿到可点餐门店的 `storeCode` 与预约时段 |
| `query-meals` | `storeCode`、`beType=1`、`orderType=1` | 拉全部分类菜单与实时价格（本单实测 125 款在售） |
| `query-store-coupons` | `storeCode`、`beType=1`、`orderType=1` | 该门店可用券、适用商品编码、有效期 |

- 其余可用能力（未在主流程使用，`npm run tools` 可查全部 35 个）：`available-coupons` / `auto-bind-coupons`（领券）、`campaign-calendar`（活动日历）、`calculate-price`（含优惠算价）、`create-order`（下单，本 Skill 不下单）。

## 真实运行结果

```bash
$ node src/plan.mjs 郑州市 30
门店：麦当劳××得来速餐厅（140XXXX）  在售餐品：125 款
推荐组合：酥脆无双套餐 ¥20 + 圆筒冰淇淋 ¥5
原价 ¥25｜实付 ¥25｜预算 30
可用券：1024“码”力翻倍（限 龙焰鸡腿堡两件套，至 2026-10-30）
```

> 开发者环境的位置能力返回固定测试门店（店名与门店编码均已脱敏），所以传「郑州市」拿到的仍是该门店；接入真实定位后 `query-nearby-stores` 会按距离返回用户附近门店，下游逻辑不用改。

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
   node src/plan.mjs 郑州市 30     # 城市、预算
   ```

5. 离线跑一遍组合器（不需要网络，数据来自 `examples/menu.json`）：

   ```bash
   npm run demo
   ```

## 在 WorkBuddy 里使用

左上角「专家 - 技能 - 连接器」→ 自定义连接器 → 添加 MCP，粘贴 `mcp.json.example` 的内容并替换 Token，保存后连接成功；再把 `SKILL.md` 里的技能说明作为技能导入（或直接把 `SKILL.md` 放进技能目录），对话里问「预算 30，国贸附近，不吃辣」即可。

## 组合器怎么算

`src/combo.mjs` 的 `planCombo(menu, coupons, budget, { prefer })`：

1. 主食 / 小食 / 饮料各取一项（`prefer` 命中的优先，例如套餐、薯条、可乐，再按价格升序），得到初始组合；
2. 对每张券算「这张券用在当前组合上能省多少」，取省得最多的一张（免费兑换、折扣、满减三类都支持）；
3. 实付超预算就按 饮料 → 小食 的顺序逐项砍掉，再重算优惠；
4. 输出组合、用掉的券、省下金额、实付与是否超预算。

`src/plan.mjs` 负责线上部分：取门店 → 拉菜单并归类（主食 / 小食 / 饮料，过滤酱料、餐具）→ 取门店券 → 交给组合器 → 输出四行结论。

## 项目结构

```
SKILL.md              技能定义与工作流程（WorkBuddy 读取）
src/mcp.mjs           MCP streamable HTTP 客户端 + CLI（ping / list / call）
src/plan.mjs          线上主流程：门店 → 菜单 → 券 → 组合
src/combo.mjs         确定性组合与优惠计算
examples/menu.json    离线演示数据
test/combo.test.mjs   组合器单元测试
mcp.json.example      连接器配置模板（不含 Token）
```

## 测试

```bash
npm test
```

纯离线、零依赖，只用 Node 内置模块（`node:test`、`fetch`），要求 Node >= 18。

## License

MIT
