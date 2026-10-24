#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { McdMcpClient } from "./mcp.mjs";
import { planCombo } from "./combo.mjs";

const DRINK = /饮品|咖啡|可乐|奶昔|茶/;
const SIDE = /小食|甜品|蘸酱|拼盘|薯条|鸡块/;
const JUNK = /酱$|酱料|餐具|吸管|打包|购物袋/;
const PREFERRED = /套餐|件套|1\+1|薯条|鸡块|冰淇淋|甜筒|派$|可乐|雪碧|纯悦/;

export function extractJson(text) {
  const start = text.lastIndexOf('{"success"');
  if (start < 0) throw new Error(`MCP 返回里找不到 JSON: ${text.slice(0, 200)}`);
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("MCP 返回的 JSON 不完整");
}

export function categoryOf(categoryName) {
  if (DRINK.test(categoryName)) return "drink";
  if (SIDE.test(categoryName)) return "side";
  return "main";
}

export function normalizeMenu(payload) {
  const { categories = [], meals = {} } = payload.data ?? {};
  const items = [];
  const seen = new Set();
  for (const category of categories) {
    const kind = categoryOf(category.name ?? "");
    for (const ref of category.meals ?? []) {
      const detail = meals[ref.code];
      if (!detail || seen.has(ref.code) || JUNK.test(detail.name ?? "")) continue;
      const price = Number(detail.currentPrice);
      if (!Number.isFinite(price) || price <= 0) continue;
      seen.add(ref.code);
      items.push({
        id: ref.code,
        name: detail.name,
        price,
        category: kind,
        originalPrice: Number(detail.originalPrice) || null,
        tags: ref.tags ?? [],
      });
    }
  }
  return items;
}

export function couponsFor(couponPayload) {
  return (couponPayload.data ?? []).map((coupon) => ({
    id: coupon.couponId,
    name: coupon.title,
    productCodes: (coupon.products ?? []).map((product) => product.productCode),
    appliesTo: (coupon.products ?? []).map((product) => product.productName).join("、"),
    validUntil: (coupon.tradeDateTime?.match(/\d{4}-\d{2}-\d{2}/g) ?? []).slice(-1)[0],
  }));
}

async function pickStore(client, city) {
  const raw = await client.callTool("query-nearby-stores", { beType: 1, city, searchType: 1 });
  const payload = extractJson(raw.content?.find((part) => part.type === "text")?.text ?? "");
  const store = payload.data?.[0];
  if (!store) throw new Error("没有查到可点餐门店");
  return store;
}

export async function plan({ city = "郑州市", budget = Infinity, storeCode } = {}) {
  const client = new McdMcpClient();
  await client.initialize();

  const store = storeCode ? { storeCode, storeName: storeCode } : await pickStore(client, city);
  const base = { storeCode: store.storeCode, beType: 1, orderType: 1 };

  const menuRaw = await client.callTool("query-meals", base);
  const items = normalizeMenu(extractJson(menuRaw.content[0].text));

  let coupons = [];
  try {
    const couponRaw = await client.callTool("query-store-coupons", base);
    coupons = couponsFor(extractJson(couponRaw.content[0].text));
  } catch {
    coupons = [];
  }

  const combo = planCombo(
    items.map(({ tags, originalPrice, ...rest }) => rest),
    [],
    budget,
    { prefer: (item) => PREFERRED.test(item.name) },
  );

  return { store, menuSize: items.length, combo, coupons };
}

function render(result) {
  const { store, combo, coupons, menuSize } = result;
  const lines = [];
  lines.push(`门店：${store.storeName}（${store.storeCode}）  在售餐品：${menuSize} 款`);
  lines.push("推荐组合：" + combo.items.map((item) => `${item.name} ¥${item.price}`).join(" + "));
  lines.push(`原价 ¥${combo.subtotal}｜实付 ¥${combo.total}｜预算 ${combo.budget ?? "不限"}`);
  const comboIds = new Set(combo.items.map((item) => item.id));
  if (coupons.length) {
    lines.push(
      "可用券：" +
        coupons
          .map((coupon) => {
            const hits = coupon.productCodes.some((code) => comboIds.has(code)) ? "★匹配本单 " : "";
            return `${hits}${coupon.name}（限 ${coupon.appliesTo}，至 ${coupon.validUntil}）`;
          })
          .join("；"),
    );
  } else {
    lines.push("可用券：当前门店未查到匹配的券");
  }
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile();
  } catch {}
  const [city, budgetArg] = process.argv.slice(2);
  plan({ city, budget: budgetArg ? Number(budgetArg) : Infinity })
    .then((result) => console.log(render(result)))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
