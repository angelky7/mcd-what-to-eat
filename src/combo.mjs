import { pathToFileURL } from "node:url";

export const CATEGORY_ORDER = ["main", "side", "drink"];

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

export function planCombo(menu, coupons = [], budget = Infinity, options = {}) {
  const prefer = options.prefer ?? (() => false);
  const cheapest = (category) =>
    menu
      .filter((item) => item.category === category && Number.isFinite(item.price))
      .sort((a, b) => Number(prefer(b)) - Number(prefer(a)) || a.price - b.price)[0];

  let items = CATEGORY_ORDER.map(cheapest).filter(Boolean);
  if (!items.length) throw new Error("菜单为空，无法组合");

  let subtotal = round2(items.reduce((sum, item) => sum + item.price, 0));
  let deal = bestCoupon(items, subtotal, coupons);

  while (subtotal - (deal?.saved ?? 0) > budget && items.length > 1) {
    items = items.slice(0, -1);
    subtotal = round2(items.reduce((sum, item) => sum + item.price, 0));
    deal = bestCoupon(items, subtotal, coupons);
  }

  const saved = deal?.saved ?? 0;
  const total = round2(Math.max(0, subtotal - saved));
  return {
    items: items.map(({ id, name, price, category }) => ({ id, name, price, category })),
    subtotal,
    coupon: deal ? { id: deal.coupon.id, name: deal.coupon.name, type: deal.coupon.type } : null,
    saved: round2(saved),
    total,
    budget: Number.isFinite(budget) ? budget : null,
    overBudget: total > budget,
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
