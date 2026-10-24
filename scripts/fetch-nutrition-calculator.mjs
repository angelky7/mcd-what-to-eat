// 抓取麦当劳官网营养计算器（https://www.mcdonalds.com.cn/nutrition_calculator）的内嵌数据。
// 页面把全部商品与营养值内嵌在 `var raw_data = {...}` 里，无需登录、无需 Key。
// 产出 data/nutrition-calculator.json：
//   { fetchedAt, source, items: [{ name, variant, portion, kj, kcal, category }] }
// 用法：node scripts/fetch-nutrition-calculator.mjs
import { writeFile, mkdir } from "node:fs/promises";

const URL_ = "https://www.mcdonalds.com.cn/nutrition_calculator";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const res = await fetch(URL_, { headers: { "user-agent": UA } });
if (!res.ok) throw new Error(`抓取失败：HTTP ${res.status}`);
const html = await res.text();

const start = html.indexOf("var raw_data = ");
if (start < 0) throw new Error("页面结构变了：找不到 raw_data");
const braceAt = html.indexOf("{", start);
let depth = 0;
let end = -1;
for (let i = braceAt; i < html.length; i += 1) {
  const ch = html[i];
  if (ch === "{") depth += 1;
  else if (ch === "}") {
    depth -= 1;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
}
if (end < 0) throw new Error("raw_data 括号不配平");
const raw = JSON.parse(html.slice(braceAt, end));

const productTypes = raw.ProductType ?? {};
const products = raw.Product ?? {};
const items = [];
for (const group of raw.category_list ?? []) {
  const category = group.ProductCategory?.title ?? "";
  for (const productId of group.Product ?? []) {
    const product = products[productId];
    if (!product) continue;
    for (const typeId of product.ProductType ?? []) {
      const type = productTypes[typeId];
      if (!type) continue;
      // nutrition = [分量(g), 能量(kJ), 蛋白质, 脂肪, 碳水, 钠, 钙, ...]
      const n = type.nutrition ?? [];
      const portion = Number(n[0]);
      const kj = Number(n[1]);
      // 0 kJ 要留着：无糖可乐确实是 0，丢了就等于「查不到」，会被当成未知去推算
      if (!Number.isFinite(kj) || kj < 0) continue;
      items.push({
        name: product.title,
        variant: type.title, // 「1个」「小」「中」「大」
        portion: Number.isFinite(portion) ? portion : null,
        kj,
        kcal: Math.round(kj / 4.184), // 与官网页面 formatKcal 的显示口径一致
        category,
      });
    }
  }
}

if (items.length < 50) throw new Error(`只解析到 ${items.length} 条，页面结构可能变了`);

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
const payload = {
  fetchedAt: new Date().toISOString().slice(0, 10),
  source: URL_,
  note: "麦当劳中国官网「营养计算器」内嵌数据；kcal 由官方千焦值除以 4.184 后四舍五入，与官网页面显示口径一致。",
  items,
};
await writeFile(new URL("../data/nutrition-calculator.json", import.meta.url), JSON.stringify(payload, null, 1) + "\n", "utf8");

const known = items.filter((i) => i.kcal > 0).length;
console.log(`已写入 data/nutrition-calculator.json：${items.length} 条（其中有热量 ${known} 条）`);
console.log(`分类：${[...new Set(items.map((i) => i.category))].join(" / ")}`);
