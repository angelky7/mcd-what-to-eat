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

const client = new McdMcpClient();
await client.initialize();

const nutrition = parseNutrition(extractJson(textOf(await client.callTool("list-nutrition-foods", {}))));
console.log(`营养表：${nutrition.size} 项`);

const stores = [];
for (const [index, store] of STORES.entries()) {
  const base = { storeCode: store.code, beType: 1, orderType: 1 };
  const raw = normalizeMenu(extractJson(textOf(await client.callTool("query-meals", base))));
  const withTable = attachCalories(raw, nutrition);
  const enriched = await enrichCalories(client, base, withTable, nutrition, {
    prefer: (item) => PREFERRED.test(item.name),
    perCategory: 14, // Demo 里每个分类多补一些，保证「最顶饱」有得选
    limit: 42,
    concurrency: 6,
  });

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
  console.log(`${store.label}：${menu.length} 款（热量已知 ${known}），券 ${coupons.length} 张`);
  stores.push({
    id: `demo-${String.fromCharCode(97 + index)}`,
    label: store.label,
    menu,
    coupons,
  });
}

await mkdir(new URL("../docs/data/", import.meta.url), { recursive: true });
const payload = {
  generatedAt: new Date().toISOString().slice(0, 10),
  note: "示例数据：真实门店菜单与官方营养数据，门店名与编码已脱敏；非实时，仅供演示。",
  stores,
};
await writeFile(new URL("../docs/data/stores.json", import.meta.url), JSON.stringify(payload, null, 1) + "\n", "utf8");
console.log("已写入 docs/data/stores.json");
