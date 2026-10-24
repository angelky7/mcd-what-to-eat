// 生成 docs/data/stores.json：真实门店菜单 + 官方热量，供在线 Demo 离线使用。
// 门店名/编码一律脱敏成「示例门店 A/B」，券只保留展示与计算所需字段，绝不写入 couponCode。
// 用法：MCD_MCP_TOKEN=xxx node scripts/build-demo-data.mjs
import { writeFile, mkdir } from "node:fs/promises";
import { McdMcpClient } from "../src/mcp.mjs";
import {
  extractJson,
  normalizeMenu,
  couponsFor,
  annotateAvailability,
  parseNutrition,
  attachCalories,
  enrichCalories,
  PREFERRED,
} from "../src/plan.mjs";

const STORES = [
  { code: "1400232", label: "示例门店 A（得来速 · 佛山）" },
  { code: "1950212", label: "示例门店 B（到店自取 · 北京前门）" },
];

const textOf = (result) => result?.content?.find((part) => part.type === "text")?.text ?? "";

try {
  process.loadEnvFile();
} catch {
  // 没有 .env 就直接用已导出的环境变量
}

const client = new McdMcpClient();
await client.initialize();

const nutrition = parseNutrition(extractJson(textOf(await client.callTool("list-nutrition-foods", {}))));
console.log(`营养表：${nutrition.size} 项`);

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

const stores = [];
for (const [index, store] of STORES.entries()) {
  const base = { storeCode: store.code, beType: 1, orderType: 1 };
  const raw = normalizeMenu(extractJson(textOf(await client.callTool("query-meals", base))));
  const withTable = attachCalories(raw, nutrition);
  const enriched = await enrichCalories(client, base, withTable, nutrition, {
    prefer: (item) => PREFERRED.test(item.name),
    perCategory: 30, // Demo 里每个分类多补一些，保证「最顶饱」有得选
    limit: 80,
    concurrency: 6,
  });
  console.log(`  ${store.label} 热量补查：调用 ${enriched.calls} 次，成功 ${enriched.resolved} 个`);

  const menu = enriched.items.map((item) => {
    const entry = { id: item.id, name: item.name, price: item.price, category: item.category };
    if (Number.isFinite(item.kcal)) entry.kcal = item.kcal;
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

  const known = menu.filter((item) => Number.isFinite(item.kcal)).length;
  const demos = demoCoupons(menu);
  console.log(`${store.label}：${menu.length} 款（热量已知 ${known}），真实券 ${coupons.length} 张 + 演示券 ${demos.length} 张`);
  stores.push({
    id: `demo-${String.fromCharCode(97 + index)}`,
    label: store.label,
    menu,
    coupons: [...demos, ...coupons],
  });
}

await mkdir(new URL("../docs/data/", import.meta.url), { recursive: true });
const payload = {
  generatedAt: new Date().toISOString().slice(0, 10),
  note: "示例数据：真实门店菜单与官方营养数据，门店名与编码已脱敏；餐品非实时。券分两类：真实门店券（只保留展示字段）与标注「虚构」的演示券（用于演示用券计算）。",
  stores,
};
await writeFile(new URL("../docs/data/stores.json", import.meta.url), JSON.stringify(payload, null, 1) + "\n", "utf8");
console.log("已写入 docs/data/stores.json");
