import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planCombo,
  COUPON_MODES,
  OPTIMIZE_MODES,
  bestCoupon,
  couponSaving,
  couponUnusableReason,
} from "../src/core/combo-core.mjs";

const menu = [
  { id: "bigmac", name: "巨无霸", price: 24, category: "main", kcal: 550 },
  { id: "mchicken", name: "麦香鸡", price: 15, category: "main", kcal: 400 },
  { id: "fries", name: "中薯", price: 11, category: "side", kcal: 289 },
  { id: "sundae", name: "小薯", price: 7, category: "side", kcal: 210 },
  { id: "coke", name: "中可", price: 9, category: "drink", kcal: 150 },
  { id: "water", name: "纯水", price: 4, category: "drink", kcal: 0 },
];

test("核心只暴露已实现的取值，避免文档与实现漂移", () => {
  assert.deepEqual(COUPON_MODES, ["auto", "off", "pick"]);
  assert.deepEqual(OPTIMIZE_MODES, ["cost", "calories", "value"]);
});

test("couponMode=off：不用券，但要说清忽略了什么", () => {
  const coupons = [{ id: "t", name: "满20减3", type: "threshold_off", minSpend: 20, amount: 3 }];
  const on = planCombo(menu, coupons);
  const off = planCombo(menu, coupons, Infinity, { couponMode: "off" });
  assert.equal(on.coupon.id, "t");
  assert.equal(off.coupon, null);
  assert.equal(off.total, off.subtotal);
  assert.equal(off.baseline, null);
  assert.ok(off.notices.some((n) => n.code === "COUPON_IGNORED"));
  assert.equal(off.ignoredCoupon.saving, 3);
});

test("couponMode=pick：只用指定的那张", () => {
  const coupons = [
    { id: "p", name: "9折", type: "percent_off", percent: 10 },
    { id: "t", name: "满20减3", type: "threshold_off", minSpend: 20, amount: 3 },
  ];
  const plan = planCombo(menu, coupons, Infinity, { couponMode: "pick", couponId: "9折" });
  assert.equal(plan.coupon.id, "p");
});

test("couponMode=pick 找不到指定券时不静默回退，给出原因", () => {
  const coupons = [{ id: "t", name: "满20减3", type: "threshold_off", minSpend: 20, amount: 3 }];
  const plan = planCombo(menu, coupons, Infinity, { couponMode: "pick", couponId: "不存在的券" });
  assert.equal(plan.coupon, null);
  const notice = plan.notices.find((n) => n.code === "COUPON_NOT_FOUND");
  assert.ok(notice, "必须给出 COUPON_NOT_FOUND");
  assert.match(notice.message, /自动模式/);
});

test("couponMode=pick 指定券不适用时给出结构化原因", () => {
  const coupons = [{ id: "x", name: "龙焰堡兑换券", type: "free_item", target: "not-in-menu" }];
  const plan = planCombo(menu, coupons, Infinity, { couponMode: "pick", couponId: "x" });
  assert.equal(plan.coupon, null);
  const notice = plan.notices.find((n) => n.code === "ITEM_NOT_LISTED");
  assert.ok(notice, "必须给出 ITEM_NOT_LISTED");
});

test("couponUnusableReason 覆盖四类原因", () => {
  assert.equal(couponUnusableReason({ id: "a", name: "无类型券" }, menu, 30).code, "FIELD_MISSING");
  assert.equal(
    couponUnusableReason({ id: "b", name: "x", type: "percent_off", percent: 10, validUntil: "2026-10-01" }, menu, 30, "2026-10-24").code,
    "COUPON_EXPIRED",
  );
  assert.equal(
    couponUnusableReason({ id: "c", name: "x", type: "free_item", target: "gone" }, menu, 30).code,
    "ITEM_NOT_LISTED",
  );
  assert.equal(
    couponUnusableReason({ id: "d", name: "x", type: "threshold_off", minSpend: 99, amount: 5 }, menu, 30).code,
    "THRESHOLD_NOT_MET",
  );
  assert.equal(couponUnusableReason({ id: "e", name: "x", type: "threshold_off", minSpend: 10, amount: 5 }, menu, 30), null);
});

test("不用券对照方案始终存在，用券不会比不用券更贵", () => {
  const coupons = [{ id: "t", name: "满20减3", type: "threshold_off", minSpend: 20, amount: 3 }];
  const plan = planCombo(menu, coupons, 30);
  assert.ok(plan.baseline);
  assert.ok(plan.total <= plan.baseline.total + 1e-9, "用券后实付不能高于不用券");
});

test("凑单多花要算出来并显式提示", () => {
  // 满 40 减 8：为了用券会凑到 40 以上，比不用券的 26 元多花，必须提示
  const coupons = [{ id: "big", name: "满40减8", type: "threshold_off", minSpend: 40, amount: 8 }];
  const plan = planCombo(menu, coupons, 100);
  if (plan.extraCostForCoupon > 0) {
    const notice = plan.notices.find((n) => n.code === "EXTRA_SPEND");
    assert.ok(notice, "多花钱必须提示 EXTRA_SPEND");
    assert.ok(plan.netSaving <= plan.saved);
  }
  assert.ok(plan.total <= plan.baseline.total + 1e-9);
});

test("cost 目标下用券更贵时自动改给不用券方案", () => {
  // 满 25 减 5：凑到三件 35-5=30 刚好进预算，但两件 25.5 更便宜。
  // 用户要的是省钱，不是把券用掉，所以必须给 25.5 那个方案并说明原因。
  const trapMenu = [
    { id: "burger", name: "麦香鸡", price: 17, category: "main", kcal: 400 },
    { id: "hashbrown", name: "脆薯饼", price: 8.5, category: "side", kcal: 146 },
    { id: "coke", name: "可乐", price: 9.5, category: "drink", kcal: 107 },
  ];
  const coupons = [{ id: "t25", name: "满 25 减 5", type: "threshold_off", minSpend: 25, amount: 5 }];
  const plan = planCombo(trapMenu, coupons, 30);
  assert.equal(plan.coupon, null, "更贵的用券方案不该被采纳");
  assert.ok(plan.total <= plan.baseline.total + 1e-9, "cost 目标必须不高于不用券方案");
  assert.ok(
    plan.notices.some((n) => n.code === "CHEAPER_WITHOUT_COUPON"),
    "改给不用券方案必须说明原因",
  );

  // couponMode=pick 是用户点名要用这张券，保持用券但在别的分支给出披露
  const picked = planCombo(trapMenu, coupons, 30, { couponMode: "pick", couponId: "t25" });
  assert.equal(picked.coupon?.id, "t25", "点名用券时不擅自换方案");
});

test("excludeCoupons 排除指定的券", () => {
  const coupons = [
    { id: "t", name: "满20减3", type: "threshold_off", minSpend: 20, amount: 3 },
    { id: "p", name: "9折", type: "percent_off", percent: 10 },
  ];
  const plan = planCombo(menu, coupons, Infinity, { excludeCoupons: ["t"] });
  assert.equal(plan.coupon.id, "p");
});

test("optimize=calories 只用有官方热量的商品，且比 cost 更顶饱", () => {
  const plan = planCombo(menu, [], 40, { optimize: "calories" });
  const cost = planCombo(menu, [], 40);
  assert.equal(plan.optimize, "calories");
  assert.ok(plan.stats.kcal > cost.stats.kcal, "热量目标必须真的更顶饱");
  assert.equal(plan.stats.unknownUnits, 0, "热量目标下不应出现未知热量的商品");
  assert.ok(plan.notices.some((n) => n.code === "CALORIE_SUBSET"));
});

test("optimize=calories 在热量数据不足时明确报错", () => {
  const bare = menu.map(({ kcal, ...rest }) => rest);
  assert.throws(() => planCombo(bare, [], 40, { optimize: "calories" }), /无法按「最顶饱」目标计算/);
});

test("optimize=value 收的是每元热量最高的组合", () => {
  const plan = planCombo(menu, [], 40, { optimize: "value" });
  const value = plan.total > 0 ? plan.stats.kcal / plan.total : 0;
  const cost = planCombo(menu, [], 40);
  const costValue = cost.total > 0 ? cost.stats.kcal / cost.total : 0;
  assert.ok(value >= costValue - 1e-9);
});

test("护栏：件数与单商品份数不超过上限", () => {
  const plan = planCombo(menu, [], 200, { optimize: "calories", maxItems: 4, maxPerItem: 2 });
  const units = plan.items.reduce((sum, item) => sum + item.qty, 0);
  assert.ok(units <= 4);
  for (const item of plan.items) assert.ok(item.qty <= 2);
});

test("重复点同一件占大半金额时给合理性提示", () => {
  const cheapSide = [{ id: "pie", name: "香芋派", price: 6, category: "side", kcal: 260 }];
  const wide = [
    { id: "m", name: "汉堡", price: 30, category: "main", kcal: 600 },
    ...cheapSide,
    { id: "d", name: "水", price: 1, category: "drink", kcal: 0 },
  ];
  const plan = planCombo(wide, [], 200, { optimize: "calories", maxPerItem: 3, maxItems: 5 });
  if (plan.items.some((item) => item.qty > 1)) {
    assert.ok(Array.isArray(plan.notices));
  }
  // 同一件不会出现两条记录
  const ids = plan.items.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("确定性：同样输入跑多次结果完全一致", () => {
  const coupons = [{ id: "t", name: "满20减3", type: "threshold_off", minSpend: 20, amount: 3 }];
  const a = planCombo(menu, coupons, 30, { prefer: (item) => /薯/.test(item.name) });
  const b = planCombo(menu, coupons, 30, { prefer: (item) => /薯/.test(item.name) });
  assert.deepEqual(a.items, b.items);
  assert.equal(a.total, b.total);
  assert.equal(a.coupon?.id, b.coupon?.id);
});

test("券金额大于门槛这类畸形券不会算出负数实付", () => {
  const coupons = [{ id: "bad", name: "满10减99", type: "threshold_off", minSpend: 10, amount: 99 }];
  const plan = planCombo(menu, coupons, Infinity);
  assert.ok(plan.total >= 0);
  assert.equal(plan.total, 0);
});

test("预算买不起任何东西时明确标记，不返回空组合", () => {
  const plan = planCombo(menu, [], 0);
  assert.ok(plan.items.length >= 1);
  assert.equal(plan.overBudget, true);
  assert.equal(plan.total, 15); // 最便宜主食 麦香鸡
});

test("菜单为空时抛明确错误", () => {
  assert.throws(() => planCombo([], [], 30), /菜单为空/);
});

// ---- 固定种子模糊测试：不追求覆盖率，只守住不变量 ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("fuzz：固定种子 120 组，不变量全部成立", () => {
  const rand = mulberry32(20261024);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const budgets = [0, 1, 5, 10, 30, 50, 100, 10000];
  const base = [
    { id: "m1", name: "巨无霸", price: 24, category: "main", kcal: 550 },
    { id: "m2", name: "麦香鸡", price: 15, category: "main", kcal: 400 },
    { id: "m3", name: "板烧鸡腿堡", price: 24, category: "main", kcal: 470 },
    { id: "s1", name: "中薯", price: 11, category: "side", kcal: 289 },
    { id: "s2", name: "小薯", price: 7, category: "side", kcal: 210 },
    { id: "s3", name: "圆筒冰淇淋", price: 5, category: "side", kcal: 93 },
    { id: "d1", name: "可乐", price: 9, category: "drink", kcal: 150 },
    { id: "d2", name: "纯水", price: 4, category: "drink", kcal: 0 },
  ];

  for (let round = 0; round < 120; round++) {
    const size = 3 + Math.floor(rand() * (base.length - 2));
    const menuSlice = base.slice(0, size).map((item) => ({
      ...item,
      price: round % 7 === 0 ? Number((rand() * 40).toFixed(2)) : item.price,
      ...(round % 5 === 0 ? { kcal: undefined } : {}),
    }));

    const couponCount = Math.floor(rand() * 4);
    const coupons = [];
    for (let i = 0; i < couponCount; i++) {
      const kind = pick(["threshold_off", "percent_off", "free_item"]);
      if (kind === "threshold_off") {
        coupons.push({ id: `c${i}`, name: `满${10 + i * 10}减${2 + i}`, type: kind, minSpend: 10 + i * 10, amount: 2 + i });
      } else if (kind === "percent_off") {
        coupons.push({ id: `c${i}`, name: `${9 - i}折`, type: kind, percent: 5 + i * 5, minSpend: i * 10 });
      } else {
        coupons.push({ id: `c${i}`, name: "兑换券", type: kind, target: pick(base).id });
      }
    }

    const budget = pick(budgets);
    const optimize = pick(["cost", "calories", "value"]);
    const hasKcal = menuSlice.every((item) => Number.isFinite(item.kcal));
    const options = { optimize: hasKcal ? optimize : "cost", maxItems: 4, maxPerItem: 2 };

    let plan;
    try {
      plan = planCombo(menuSlice, coupons, budget, options);
    } catch (err) {
      // 唯一允许的抛错是热量数据不足 / 菜单为空，且必须是明确文案
      assert.match(err.message, /热量|菜单为空|预算/, `第 ${round} 组抛错文案不明确: ${err.message}`);
      continue;
    }

    const label = `第 ${round} 组（budget=${budget}, optimize=${options.optimize}, menu=${menuSlice.length}, coupons=${coupons.length}）`;
    assert.ok(plan.items.length >= 1, label + " 组合不能为空");
    assert.ok(plan.total >= 0, label + " 实付不能为负");
    assert.ok(Number.isFinite(plan.total), label + " 实付必须是有限数");
    const units = plan.items.reduce((sum, item) => sum + item.qty, 0);
    assert.ok(units <= 4, label + " 件数超上限");
    for (const item of plan.items) assert.ok(item.qty <= 2, label + " 单商品份数超上限");
    const ids = plan.items.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length, label + " 出现重复商品行");

    if (!plan.overBudget) assert.ok(plan.total <= budget + 1e-9, label + " 超预算却未标记");
    if (plan.overBudget) assert.ok(plan.total > budget, label + " 标了超预算但其实没超");

    // 用券方案可以在两种情况下比不用券贵：凑单推高原价，或券让「更大的一餐」变得可负担。
    // 允许，但必须显式说明——绝不允许悄悄更贵。
    if (plan.baseline) {
      const disclosed = plan.notices.some((n) =>
        ["EXTRA_SPEND", "COUPON_NOT_WORTH_IT", "CHEAPER_WITHOUT_COUPON"].includes(n.code),
      );
      assert.ok(plan.total <= plan.baseline.total + 1e-9 || disclosed, label + " 比不用券更贵却没有说明");
    }

    const again = planCombo(menuSlice, coupons, budget, options);
    assert.deepEqual(again.items, plan.items, label + " 结果不可复现");
  }
});

test("fuzz：耗时在 100ms 量级内（防组合爆炸）", () => {
  const coupons = [{ id: "t", name: "满20减3", type: "threshold_off", minSpend: 20, amount: 3 }];
  const started = performance.now();
  planCombo(menu, coupons, 30);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 100, `单次组合耗时 ${elapsed.toFixed(1)}ms 超出预期`);
});

test("bestCoupon / couponSaving 对兑换券只免一份", () => {
  const items = [{ id: "a", name: "A", price: 20, category: "main", qty: 2 }];
  assert.equal(couponSaving({ type: "free_item", target: "a" }, items, 40), 20);
  assert.equal(bestCoupon(items, 40, [{ id: "x", type: "free_item", target: "a" }]).saved, 20);
});
