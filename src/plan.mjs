#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { McdMcpClient } from "./mcp.mjs";
import { planCombo, CATEGORY_ORDER } from "./combo.mjs";

// 餐品类型判定：以商品名为主信号，分类名兜底。
// 实测菜单仅按分类名归类会出错，原因有三：
//   1)「人气热卖」是跨分类营销位，同一商品会在聚合位与真实分类各出现一次，
//     去重时先命中聚合位，就把分类带偏了（心形薯饼、蘸酱炸鸡曾被当成主食）；
//   2) 非餐品混在菜单里（丝巾 ¥34.9、水手帽 ¥48.8、毛绒周边、玩具袋、3 元蘸酱）；
//   3) 分类名含换行（「小食甜品\n/其他」），且「小食拼盘/多人餐」「BFF四宫格」
//     是双人分享餐而非小食，不能因「小食」二字塞进小食位。
const MERCH = /丝巾|围巾|帽|毛绒|周边|玩偶|手办|盲盒|百宝袋|痒痒挠|按摩捶|餐具|吸管|打包|购物袋|徽章|贴纸|冰箱贴|杯套|酱$|酱料/;
const SHARE = /拼盘|分享餐|双人餐|多人餐|四宫格|双拼|全家|桶/;
const COMBO = /套餐|件套|随心|乐园餐/;
const DRINK_ITEM =
  /可乐|雪碧|芬达|怡泉|纯悦|牛奶|奶昔|果汁|苹果汁|柠柠|橙|红茶|绿茶|乌龙|咖啡|美式|拿铁|奶铁|燕麦奶|卡布奇诺|浓缩|黑巧|可可|抹茶|阿芙佳朵|汽水|饮用水|矿泉水|饮品/;
const SIDE_ITEM =
  /薯条|薯饼|薯格|扭扭薯|鸡块|鸡翅|翅|鸡排|炸鸡|脆汁鸡|肉骨鸡|芝士条|玉米杯|苹果片|冰淇淋|圆筒|甜筒|圣代|新地|麦旋风|派$|蛋挞|沙拉|布丁|蛋糕|饼干|双全盒/;
const MAIN_ITEM = /堡|卷/;
const DRINK_CAT = /饮品|饮料|咖啡|茶/;
const SIDE_CAT = /小食|甜品|蘸酱|薯条|鸡块|炸鸡/;
const PREFERRED = /套餐|件套|随心|1\+1|薯条|鸡块|冰淇淋|甜筒|派$|可乐|雪碧|纯悦/;

const round2 = (n) => Math.round(n * 100) / 100;

// 券的标题语义：官方 MCP 未发布优惠券响应体字段文档，
// 因此按「结构化字段优先、中文标题兜底」的策略映射。
const TITLE_RULES = [
  { re: /(\d+(?:\.\d+)?)\s*折/, make: (m) => ({ type: "percent_off", percent: (10 - Number(m[1])) * 10 }) },
  { re: /满\s*(\d+(?:\.\d+)?)\s*减\s*(\d+(?:\.\d+)?)/, make: (m) => ({ type: "threshold_off", minSpend: Number(m[1]), amount: Number(m[2]) }) },
  { re: /立减\s*(\d+(?:\.\d+)?)/, make: (m) => ({ type: "threshold_off", minSpend: 0, amount: Number(m[1]) }) },
  { re: /(?:免费)?兑换|零元|0\s*元|免费赠/, make: () => ({ type: "free_item" }) },
];

const TYPE_KEYWORDS = [
  { keys: ["free_item", "freeitem", "free", "exchange", "兑换", "赠品", "赠券"], type: "free_item" },
  { keys: ["percent", "discount", "打折", "折扣"], type: "percent_off" },
  { keys: ["threshold", "fullcut", "full", "满减", "满元"], type: "threshold_off" },
];

const TYPE_FIELDS = ["couponType", "type", "preferentialType", "discountType", "couponKind", "preferentialWay"];
const MIN_SPEND_FIELDS = ["threshold", "minSpend", "useThreshold", "conditionAmount", "fullAmount", "limitAmount"];
const AMOUNT_FIELDS = ["amount", "discountAmount", "reduce", "subtract", "cut"];
const PERCENT_FIELDS = ["discount", "percent", "discountRate", "discountPercent", "rate"];
const REMAINING_FIELDS = ["remaining", "stock", "couponRemaining", "usableQuantity", "quantity"];

function firstFinite(raw, fields, { positive = true } = {}) {
  for (const field of fields) {
    const n = Number(raw?.[field]);
    if (Number.isFinite(n) && (!positive || n > 0)) return n;
  }
  return undefined;
}

function structuredType(raw) {
  for (const field of TYPE_FIELDS) {
    const value = raw?.[field];
    if (value == null) continue;
    if (typeof value === "string") {
      const lower = value.toLowerCase();
      const hit = TYPE_KEYWORDS.find((rule) => rule.keys.some((key) => lower.includes(key)));
      if (hit) return hit.type;
    }
    // 数字编码各家不统一，不猜
  }
  return null;
}

// 折扣数值归一：0<v<1 视为折扣率（0.9 → 10% off），1<=v<=10 视为「几折」（9 → 10% off），>10 视为百分点。
function normalizePercent(value) {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const round2 = (n) => Math.round(n * 100) / 100;
  if (value < 1) return round2((1 - value) * 100);
  if (value <= 10) return round2((10 - value) * 10);
  return round2(value);
}

export function extractJson(text) {
  if (typeof text !== "string") throw new Error("MCP 返回里找不到文本内容");
  try {
    const direct = JSON.parse(text);
    if (direct && typeof direct === "object") return direct;
  } catch {}
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

const textPart = (result) => result?.content?.find((part) => part.type === "text")?.text ?? "";

// 判定顺序：饮品 → 分享餐 → 套餐 → 小食 → 汉堡/卷 → 分类名兜底 → 主食。
// 「麦辣鸡翅4块套餐」含小食词但是正餐，「学生专享饮品随心选」含套餐词但是饮品，
// 所以套餐判定要排在饮品之后、小食之前。
// 兼容旧调用：只传分类名时按分类名判定。
export function categoryOf(categoryName = "", itemName = "") {
  const name = String(itemName).replace(/\s+/g, "");
  const cat = String(categoryName).replace(/\s+/g, "");
  if (DRINK_ITEM.test(name)) return "drink";
  if (SHARE.test(name)) return "main";
  if (COMBO.test(name)) return "main";
  if (SIDE_ITEM.test(name)) return "side";
  if (MAIN_ITEM.test(name)) return "main";
  if (DRINK_CAT.test(cat)) return "drink";
  if (SIDE_CAT.test(cat)) return "side";
  return "main";
}

export function normalizeMenu(payload) {
  const { categories = [], meals = {} } = payload.data ?? {};
  const items = [];
  const seen = new Set();
  for (const category of categories) {
    for (const ref of category.meals ?? []) {
      const detail = meals[ref.code];
      const name = detail?.name ?? "";
      if (!detail || seen.has(ref.code) || MERCH.test(name.replace(/\s+/g, ""))) continue;
      const price = Number(detail.currentPrice);
      if (!Number.isFinite(price) || price <= 0) continue;
      seen.add(ref.code);
      items.push({
        id: ref.code,
        name: detail.name,
        price,
        category: categoryOf(category.name ?? "", detail.name ?? ""),
        originalPrice: Number(detail.originalPrice) || null,
        tags: ref.tags ?? [],
      });
    }
  }
  return items;
}

export function couponsFor(couponPayload) {
  return (couponPayload.data ?? []).map((coupon) => {
    const productCodes = (coupon.products ?? []).map((product) => product.productCode).filter(Boolean);
    const mapped = {
      id: coupon.couponId ?? coupon.id,
      code: coupon.couponCode,
      name: coupon.title ?? coupon.name ?? "未命名优惠券",
      productCodes,
      appliesTo: (coupon.products ?? []).map((product) => product.productName).filter(Boolean).join("、"),
      validUntil: (coupon.tradeDateTime?.match(/\d{4}-\d{2}-\d{2}/g) ?? []).slice(-1)[0],
    };

    // 结构化字段优先，标题语义兜底
    const type = structuredType(coupon);
    const title = mapped.name;
    const percentTitle = TITLE_RULES[0].re.exec(title);
    const thresholdTitle = TITLE_RULES[1].re.exec(title);
    if (type === "free_item") {
      mapped.type = "free_item";
      mapped.target = coupon.productCode ?? coupon.targetProductCode ?? productCodes[0];
    } else if (type === "percent_off") {
      mapped.type = "percent_off";
      mapped.percent = normalizePercent(firstFinite(coupon, PERCENT_FIELDS)) ?? (percentTitle ? (10 - Number(percentTitle[1])) * 10 : undefined);
      mapped.minSpend = firstFinite(coupon, MIN_SPEND_FIELDS) ?? 0;
    } else if (type === "threshold_off") {
      mapped.type = "threshold_off";
      mapped.minSpend = firstFinite(coupon, MIN_SPEND_FIELDS) ?? (thresholdTitle ? Number(thresholdTitle[1]) : 0);
      mapped.amount = firstFinite(coupon, AMOUNT_FIELDS) ?? (thresholdTitle ? Number(thresholdTitle[2]) : undefined);
    } else {
      const titleHit = TITLE_RULES.find((rule) => rule.re.test(title));
      if (titleHit) {
        Object.assign(mapped, titleHit.make(title.match(titleHit.re)));
        if (mapped.type === "free_item") mapped.target = coupon.productCode ?? productCodes[0];
      }
    }
    // 映射不出类型的券保留在展示列表里，但不参与计算（couponSaving 对未知类型返回 0）

    mapped.remaining = firstFinite(coupon, REMAINING_FIELDS);
    return mapped;
  });
}

// 为「无法本地计算优惠」的券构造候选组合：用最便宜的适用商品替换同分类现有商品，
// 组合里没有该分类时追加。返回 null 表示该券的适用商品都不在售。
export function oracleCombo(comboItems, coupon, menu) {
  const applicable = menu
    .filter((item) => coupon.productCodes?.includes(item.id))
    .sort((a, b) => a.price - b.price);
  if (!applicable.length) return null;
  const cheapest = applicable[0];
  const next = comboItems.map((item) => ({ ...item }));
  const idx = next.findIndex((item) => item.category === cheapest.category);
  if (idx >= 0) next[idx] = cheapest;
  else next.push(cheapest);
  next.sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
  return next;
}

// 用官方 calculate-price 探测组合的真实应付价（单位从分换算为元）。
// coupon 为 null 时探测原价；返回 null 表示探测失败或服务端拒绝（如促销规则不支持该商品）。
export async function probePrice(client, base, items, coupon = null) {
  const payload = {
    ...base,
    items: items.map((item) => {
      const entry = { productCode: item.id, quantity: 1 };
      if (coupon && coupon.productCodes?.includes(item.id)) {
        entry.couponId = coupon.id;
        entry.couponCode = coupon.code;
      }
      return entry;
    }),
  };
  let raw;
  try {
    raw = await client.callTool("calculate-price", payload);
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = extractJson(textPart(raw));
  } catch {
    return null;
  }
  if (!parsed?.success || !parsed?.data) return null;
  const price = Number(parsed.data.price);
  if (!Number.isFinite(price)) return null;
  return { price: price / 100, discount: Number(parsed.data.discount ?? 0) / 100 };
}

// 标注券的目标商品是否在本店在售：券目标商品可能已下架或未上架，
// 这类券只能展示、不能算优惠，输出时必须说清楚，避免用户以为能用。
export function annotateAvailability(coupons, items) {
  const onSale = new Set(items.map((item) => item.id));
  for (const coupon of coupons) {
    if (!coupon.productCodes?.length) {
      coupon.targetOnSale = null; // 未限定商品，无法判断
      continue;
    }
    coupon.targetOnSale = coupon.productCodes.some((code) => onSale.has(code));
  }
  return coupons;
}

// 门店定位。官方接口的 searchType 语义容易踩坑：
//   searchType=2 按地点搜索（必须带 keyword）；searchType=1 只搜「收藏餐厅」且忽略 city。
// 实测 searchType=1 传 city=北京市 返回的是账号收藏的佛山门店，因此城市查询必须走 2，
// 搜不到才退回收藏门店，并在输出里说明，避免「要北京却给了佛山」还看起来正常。
export async function pickStore(client, city = "郑州市", keyword) {
  const queries = [];
  const q = keyword || city;
  if (q) queries.push({ beType: 1, city, keyword: q, searchType: 2 });
  if (city && city !== q) queries.push({ beType: 1, city, keyword: city, searchType: 2 });
  queries.push({ beType: 1, searchType: 1 });
  for (const params of queries) {
    let payload;
    try {
      payload = extractJson(textPart(await client.callTool("query-nearby-stores", params)));
    } catch {
      continue;
    }
    const store = payload?.data?.[0];
    if (payload?.success && store?.storeCode) {
      return { store, source: params.searchType === 2 ? "location" : "favorite" };
    }
  }
  throw new Error(`没有查到可点餐门店（城市：${city}）`);
}

export function parseBudget(arg) {
  if (arg == null || arg === "") return Infinity;
  const n = Number(arg);
  if (!Number.isFinite(n) || n < 0) throw new Error(`预算必须是不小于 0 的数字，收到: ${arg}`);
  return n;
}

export async function plan({ city = "郑州市", budget = Infinity, storeCode, keyword } = {}) {
  const client = new McdMcpClient();
  await client.initialize();

  let store;
  let storeSource;
  if (storeCode) {
    store = { storeCode, storeName: storeCode };
    storeSource = "given";
  } else {
    const picked = await pickStore(client, city, keyword);
    store = picked.store;
    storeSource = picked.source;
  }
  const base = { storeCode: store.storeCode, beType: 1, orderType: 1 };

  const menuRaw = await client.callTool("query-meals", base);
  const items = normalizeMenu(extractJson(textPart(menuRaw)));

  let coupons = [];
  try {
    const couponRaw = await client.callTool("query-store-coupons", base);
    coupons = annotateAvailability(couponsFor(extractJson(textPart(couponRaw))), items);
  } catch {
    coupons = [];
  }

  const combo = planCombo(
    items.map(({ tags, originalPrice, ...rest }) => rest),
    coupons,
    budget,
    { prefer: (item) => PREFERRED.test(item.name) },
  );

  // 价格探针：无法本地计算优惠的券（载荷里没有类型/金额字段，如活动券），
  // 用官方 calculate-price 探测真实节省；更省且在预算内则采用探针组合。
  // 每个券最多 3 次探测，任何失败都降级为「仅展示」，不影响主流程。
  const limit = Number.isFinite(budget) ? budget : Infinity;
  let best = { items: combo.items, subtotal: combo.subtotal, saved: combo.saved, total: combo.total, coupon: combo.coupon, via: "local" };
  const consider = (cand) => {
    if (cand.total >= best.total) return;
    if (cand.total > limit && best.total <= limit) return;
    best = cand;
  };
  for (const coupon of coupons) {
    if (coupon.type || coupon.remaining === 0) continue;
    const oracleItems = oracleCombo(combo.items, coupon, items);
    const appliesToCombo = combo.items.some((item) => coupon.productCodes?.includes(item.id));
    const differs =
      oracleItems && (oracleItems.length !== combo.items.length || oracleItems.some((item, i) => item.id !== combo.items[i]?.id));
    if (!appliesToCombo && !differs) continue; // 券与当前组合无关，保持仅展示
    // 候选一：本地最优组合原样挂券（覆盖订单级优惠）
    const withOnLocal = await probePrice(client, base, combo.items, coupon);
    if (withOnLocal && withOnLocal.price < combo.subtotal) {
      consider({
        items: combo.items,
        subtotal: combo.subtotal,
        saved: round2(combo.subtotal - withOnLocal.price),
        total: withOnLocal.price,
        coupon: { id: coupon.id, name: coupon.name, type: "price_oracle" },
        via: "oracle",
      });
    }
    // 候选二：把券的适用商品编进组合再挂券（覆盖商品级优惠）
    if (differs) {
      const basePrice = await probePrice(client, base, oracleItems, null);
      const withCoupon = await probePrice(client, base, oracleItems, coupon);
      if (basePrice && withCoupon && withCoupon.price < basePrice.price) {
        consider({
          items: oracleItems,
          subtotal: round2(oracleItems.reduce((sum, item) => sum + item.price, 0)),
          saved: round2(basePrice.price - withCoupon.price),
          total: withCoupon.price,
          coupon: { id: coupon.id, name: coupon.name, type: "price_oracle" },
          via: "oracle",
        });
      }
    }
  }

  const finalCombo =
    best.via === "local"
      ? combo
      : {
          items: best.items.map(({ id, name, price, category }) => ({ id, name, price, category })),
          subtotal: best.subtotal,
          coupon: best.coupon,
          saved: best.saved,
          total: round2(best.total),
          budget: Number.isFinite(budget) ? budget : null,
          overBudget: best.total > limit,
        };

  return { store, storeSource, menuSize: items.length, combo: finalCombo, coupons };
}

function render(result) {
  const { store, storeSource, combo, coupons, menuSize } = result;
  const lines = [];
  const sourceNote = storeSource === "favorite" ? "｜⚠ 未搜到该城市的门店，沿用收藏门店" : "";
  lines.push(`门店：${store.storeName}（${store.storeCode}）  在售餐品：${menuSize} 款${sourceNote}`);
  lines.push("推荐组合：" + combo.items.map((item) => `${item.name} ¥${item.price}`).join(" + "));
  const priceLine = [`原价 ¥${combo.subtotal}`];
  if (combo.coupon) priceLine.push(`券 -¥${combo.saved}（${combo.coupon.name}）`);
  priceLine.push(`实付 ¥${combo.total}`, `预算 ${combo.budget ?? "不限"}`);
  if (combo.overBudget) priceLine.push("⚠ 超预算");
  lines.push(priceLine.join("｜"));
  const usedId = combo.coupon?.id;
  if (coupons.length) {
    const comboIds = new Set(combo.items.map((item) => item.id));
    lines.push(
      "可用券：" +
        coupons
          .map((coupon) => {
            const valid = `限 ${coupon.appliesTo || "指定商品"}，至 ${coupon.validUntil ?? "未知"}`;
            if (coupon.id === usedId) return `★已用 ${coupon.name}（${valid}）`;
            const hits = coupon.productCodes.some((code) => comboIds.has(code)) ? "★匹配本单 " : "";
            const cold = coupon.targetOnSale === false ? "｜目标商品本店未在售" : "";
            return `${hits}${coupon.name}（${valid}${cold}）`;
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
  const [city, budgetArg, keyword] = process.argv.slice(2);
  let budget = Infinity;
  try {
    budget = parseBudget(budgetArg);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  plan({ city, budget, keyword })
    .then((result) => console.log(render(result)))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
