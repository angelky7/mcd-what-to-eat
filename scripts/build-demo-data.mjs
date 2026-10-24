// 生成 docs/data/stores.json：真实门店菜单 + 官方热量，供在线 Demo 离线使用。
//
// 热量走三级官方来源（见 src/nutrition.mjs）：
//   1) list-nutrition-foods（MCP 接口）
//   2) 官网营养计算器 data/nutrition-calculator.json
//   3) query-meal-detail 的 rounds[] 子项累加（套餐、随心配、带规格饮料都靠这个）
// 剩下实在查不到的单品才按同类推算，并在数据里标 source=estimate，页面上显示成「≈」。
//
// 门店名与编码一律脱敏成「北京 · 前门」「上海 · 黄浦」，券不写入 couponCode。
// 用法：MCD_MCP_TOKEN=xxx node scripts/build-demo-data.mjs
import { writeFile, mkdir, readFile, stat } from "node:fs/promises";
import { McdMcpClient } from "../src/mcp.mjs";
import {
  extractJson,
  normalizeMenu,
  couponsFor,
  annotateAvailability,
  parseNutrition,
  createResolver,
  attachCalories,
  enrichCalories,
  loadCalculator,
} from "../src/plan.mjs";

const STORES = [
  { code: "1950212", label: "北京 · 前门", scene: "到店自取" },
  { code: "1450713", label: "上海 · 黄浦", scene: "到店自取" },
];

const textOf = (result) => result?.content?.find((part) => part.type === "text")?.text ?? "";

try {
  process.loadEnvFile();
} catch {
  // 没有 .env 就直接用已导出的环境变量
}

const client = new McdMcpClient();
await client.initialize();

let mcpTable = new Map();
try {
  mcpTable = parseNutrition(extractJson(textOf(await client.callTool("list-nutrition-foods", {}))));
} catch {
  mcpTable = new Map();
}
const calculator = loadCalculator();
const resolver = createResolver({ mcpTable, calculator });
console.log(`热量索引：MCP 营养表 ${mcpTable.size} 项 + 官网营养计算器 ${calculator.length} 条 → ${resolver.size} 个商品名`);

// 真实门店券实测只有 title/couponId/tradeDateTime，本地算不出优惠（线上靠 calculate-price 试算）。
// Demo 没有网络，为了能演示「券感知组合」，额外加几张**明确标注为虚构**的演示券。
function demoCoupons(items) {
  const coupons = [];
  const sundae = items.find((item) => item.name === "圆筒冰淇淋");
  if (sundae) {
    coupons.push({
      id: "demo-free",
      name: "演示券·免费兑换圆筒冰淇淋（虚构）",
      appliesTo: sundae.name,
      validUntil: null,
      targetOnSale: true,
      type: "free_item",
      target: sundae.id,
      demo: true,
    });
  }
  coupons.push({
    id: "demo-threshold",
    name: "演示券·满 25 减 5（虚构）",
    appliesTo: "全部商品",
    validUntil: null,
    targetOnSale: true,
    type: "threshold_off",
    minSpend: 25,
    amount: 5,
    demo: true,
  });
  coupons.push({
    id: "demo-percent",
    name: "演示券·全场 9 折（虚构）",
    appliesTo: "全部商品",
    validUntil: null,
    targetOnSale: true,
    type: "percent_off",
    percent: 10,
    demo: true,
  });
  return coupons;
}

// 只保留「真的能换」的轮次（有多个选项），单选项的轮次没有展示价值，但热度仍要算
function slimCombo(combo) {
  if (!combo?.rounds?.length) return null;
  const rounds = combo.rounds
    .filter((round) => round.choices.length > 1)
    .map((round) => ({
      name: round.name,
      picked: round.picked,
      choices: round.choices.map((choice) => {
        const entry = { code: choice.code, name: choice.name, diffPrice: choice.diffPrice };
        if (choice.isDefault) entry.isDefault = true;
        if (Number.isFinite(choice.kcal)) entry.kcal = choice.kcal;
        return entry;
      }),
    }));
  return rounds.length ? { rounds } : null;
}

const stores = [];
for (const [index, store] of STORES.entries()) {
  const base = { storeCode: store.code, beType: 1, orderType: 1 };
  const raw = normalizeMenu(extractJson(textOf(await client.callTool("query-meals", base))));
  const withName = attachCalories(raw, resolver);
  // force：全菜单都查一次详情，这样套餐能按子项累加、带规格的饮料能拿到真实杯型
  const enriched = await enrichCalories(client, base, withName, resolver, { force: true, limit: 500, concurrency: 6 });
  console.log(`  ${store.label} 构成补查：调用 ${enriched.calls} 次，命中 ${enriched.resolved} 个`);

  const menu = enriched.items.map((item) => {
    const entry = { id: item.id, name: item.name, price: item.price, category: item.category };
    if (Number.isFinite(item.kcal)) entry.kcal = item.kcal;
    if (item.kcalSource) entry.kcalSource = item.kcalSource;
    if (item.kcalLabel) entry.kcalLabel = item.kcalLabel;
    if (item.kcalAssume) entry.kcalAssume = item.kcalAssume;
    const combo = slimCombo(item.combo);
    if (combo) entry.combo = combo;
    return entry;
  });

  let coupons = [];
  try {
    const couponRaw = couponsFor(extractJson(textOf(await client.callTool("query-store-coupons", base))));
    coupons = annotateAvailability(couponRaw, enriched.items).map((coupon) => {
      const entry = {
        id: coupon.id,
        name: coupon.name,
        appliesTo: coupon.appliesTo,
        validUntil: coupon.validUntil,
        targetOnSale: coupon.targetOnSale,
      };
      for (const field of ["type", "target", "percent", "minSpend", "amount"]) {
        if (coupon[field] != null) entry[field] = coupon[field];
      }
      return entry;
    });
  } catch {
    coupons = [];
  }

  const bySource = {};
  for (const item of menu) bySource[item.kcalSource ?? "unknown"] = (bySource[item.kcalSource ?? "unknown"] ?? 0) + 1;
  const demos = demoCoupons(menu);
  console.log(
    `${store.label}：${menu.length} 款｜${Object.entries(bySource)
      .map(([key, value]) => `${key} ${value}`)
      .join(" / ")}｜真实券 ${coupons.length} + 演示券 ${demos.length}`,
  );
  stores.push({
    id: `demo-${String.fromCharCode(97 + index)}`,
    label: store.label,
    scene: store.scene,
    menu,
    coupons: [...demos, ...coupons],
  });
}

await mkdir(new URL("../docs/data/", import.meta.url), { recursive: true });
const calculatorMeta = JSON.parse(await readFile(new URL("../data/nutrition-calculator.json", import.meta.url), "utf8"));
const payload = {
  generatedAt: new Date().toISOString().slice(0, 10),
  nutrition: {
    mcp: mcpTable.size,
    calculator: calculator.length,
    calculatorFetchedAt: calculatorMeta.fetchedAt,
  },
  note: "示例数据：真实门店菜单与官方热量（MCP 营养表 + 官网营养计算器 + 套餐子项累加），门店名与编码已脱敏；餐品非实时。券分两类：真实门店券（只保留展示字段）与标注「虚构」的演示券（用于演示用券计算）。",
  stores,
};
await writeFile(new URL("../docs/data/stores.json", import.meta.url), JSON.stringify(payload) + "\n", "utf8");
const size = await stat(new URL("../docs/data/stores.json", import.meta.url));
console.log(`已写入 docs/data/stores.json（${Math.round(size.size / 1024)} KB）`);
