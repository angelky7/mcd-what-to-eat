import { pathToFileURL } from "node:url";

export const CATEGORY_ORDER = ["main", "side", "drink"];

// 每个分类进入枚举的候选数：偏好优先、价格升序取前 TOP_K，
// 另外保证被免费兑换券指定的商品一定在候选里（否则贵价商品永远落选，券就用不上）。
const TOP_K = 3;

const round2 = (n) => Math.round(n * 100) / 100;

function couponSaving(coupon, items, subtotal) {
  switch (coupon.type) {
    case "free_item": {
      const hit = items.find((item) => item.id === coupon.target);
      return hit ? Math.min(hit.price, subtotal) : 0;
    }
    case "percent_off":
      return subtotal >= (coupon.minSpend ?? 0) ? subtotal * ((coupon.percent ?? 0) / 100) : 0;
    case "threshold_off":
      return subtotal >= (coupon.minSpend ?? 0) ? Math.min(coupon.amount ?? 0, subtotal) : 0;
    default:
      return 0;
  }
}

export function bestCoupon(items, subtotal, coupons = []) {
  let best = null;
  for (const coupon of coupons) {
    if (coupon.remaining === 0) continue;
    const saved = couponSaving(coupon, items, subtotal);
    if (saved > 0 && (!best || saved > best.saved)) best = { coupon, saved: round2(saved) };
  }
  return best;
}

function candidatePool(menu, category, prefer, couponTargets) {
  const pool = menu.filter((item) => item.category === category && Number.isFinite(item.price) && item.price > 0);
  if (!pool.length) return [];
  pool.sort((a, b) => Number(prefer(b)) - Number(prefer(a)) || a.price - b.price);
  const picked = pool.slice(0, TOP_K);
  // 全球最便宜的商品保底进候选：偏好项都超预算时，枚举仍能找到预算内的便宜替代
  const cheapest = pool.reduce((a, b) => (a.price <= b.price ? a : b));
  if (!picked.includes(cheapest)) picked.push(cheapest);
  for (const item of pool) {
    if (couponTargets.has(item.id) && !picked.includes(item)) picked.push(item);
  }
  return picked;
}

// 超预算时按契约依次砍掉末尾分类（饮料 → 小食），因此候选组合按
//「完整前缀 → 逐步截短」的顺序生成，第一个能塞进预算的前缀即采用。
function categoryPrefixes(categories) {
  const out = [];
  for (let i = categories.length; i >= 1; i--) out.push(categories.slice(0, i));
  return out;
}

function* product(arrays) {
  if (!arrays.length) {
    yield [];
    return;
  }
  const [head, ...rest] = arrays;
  for (const item of head) {
    for (const combo of product(rest)) yield [item, ...combo];
  }
}

// 同一前缀内：先比偏好命中数（套餐/薯条/可乐这类搭配意图优先），再比实付，
// 再比省下的金额（鼓励用券），最后比原价。偏好只在预算内生效——
// 偏好组合超预算时，候选池里的最便宜保底项保证仍有预算内答案。
function preferredCount(items, prefer) {
  return items.reduce((count, item) => count + Number(Boolean(prefer(item))), 0);
}

function betterCandidate(next, current, prefer) {
  if (!current) return true;
  const nextPref = preferredCount(next.items, prefer);
  const currentPref = preferredCount(current.items, prefer);
  if (nextPref !== currentPref) return nextPref > currentPref;
  if (next.total !== current.total) return next.total < current.total;
  if (next.saved !== current.saved) return next.saved > current.saved;
  return next.subtotal < current.subtotal;
}

export function planCombo(menu, coupons = [], budget = Infinity, options = {}) {
  const limit = Number.isFinite(budget) ? budget : Infinity;
  const prefer = options.prefer ?? (() => false);

  const couponTargets = new Set(
    coupons.filter((c) => c.type === "free_item" && c.target && c.remaining !== 0).map((c) => c.target),
  );

  const categories = CATEGORY_ORDER.filter((category) =>
    menu.some((item) => item.category === category && Number.isFinite(item.price) && item.price > 0),
  );
  if (!categories.length) throw new Error("菜单为空，无法组合");

  const pools = categories.map((category) => candidatePool(menu, category, prefer, couponTargets));

  const evaluate = (items) => {
    const subtotal = round2(items.reduce((sum, item) => sum + item.price, 0));
    const deal = bestCoupon(items, subtotal, coupons);
    const saved = deal?.saved ?? 0;
    return { items, subtotal, deal, saved, total: round2(Math.max(0, subtotal - saved)) };
  };

  let chosen = null;
  for (const prefix of categoryPrefixes(categories)) {
    const poolsForPrefix = pools.slice(0, prefix.length);
    let bestInPrefix = null;
    for (const combo of product(poolsForPrefix)) {
      const candidate = evaluate(combo);
      if (candidate.total <= limit && betterCandidate(candidate, bestInPrefix, prefer)) bestInPrefix = candidate;
    }
    if (bestInPrefix) {
      chosen = bestInPrefix;
      break;
    }
  }

  // 没有任何前缀能塞进预算：保留最短前缀（主食优先）的最便宜组合，标记超预算。
  if (!chosen) {
    const shortest = pools[0];
    chosen = evaluate([shortest.reduce((a, b) => (a.price <= b.price ? a : b))]);
  }

  const saved = chosen.saved;
  const total = chosen.total;
  return {
    items: chosen.items.map(({ id, name, price, category }) => ({ id, name, price, category })),
    subtotal: chosen.subtotal,
    coupon: chosen.deal ? { id: chosen.deal.coupon.id, name: chosen.deal.coupon.name, type: chosen.deal.coupon.type } : null,
    saved: round2(saved),
    total,
    budget: Number.isFinite(budget) ? budget : null,
    overBudget: total > limit,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, budgetArg] = process.argv.slice(2);
  if (!file) {
    console.error("用法: node src/combo.mjs <menu.json> [预算]");
    process.exit(1);
  }
  const { readFile } = await import("node:fs/promises");
  const { items = [], coupons = [] } = JSON.parse(await readFile(file, "utf8"));
  const budget = budgetArg ? Number(budgetArg) : Infinity;
  console.log(JSON.stringify(planCombo(items, coupons, budget), null, 2));
}
