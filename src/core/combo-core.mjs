// 纯计算核心：不导入任何 node: 模块、不使用 process，
// 因此 Node 与浏览器（GitHub Pages Demo）共用同一份实现，点餐方案的算法只有一份。
// CLI 封装在 src/combo.mjs，线上取数流程在 src/plan.mjs。

export const CATEGORY_ORDER = ["main", "side", "drink"];
export const OPTIMIZE_MODES = ["cost", "calories", "value"];
export const COUPON_MODES = ["auto", "off", "pick"];

export const OPTIMIZE_LABEL = { cost: "最省", calories: "最顶饱", value: "每元热量最高" };
const CATEGORY_LABEL = { main: "主食", side: "小食", drink: "饮品" };

// 每个分类进入枚举的候选数：偏好优先、价格升序取前 TOP_K。
const TOP_K = 3;
// 护栏：默认最多 4 件、单个商品最多 2 份。数量维度只为「凑单 / 更顶饱」存在，
// 不是无限叠加——没有上限就会出现「几十个香芋派」那种数学最优、现实荒谬的解。
const DEFAULT_MAX_ITEMS = 4;
const DEFAULT_MAX_PER_ITEM = 2;

const round2 = (n) => Math.round(n * 100) / 100;

function positiveInt(value, fallback) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

export function couponSaving(coupon, items, subtotal) {
  switch (coupon.type) {
    case "free_item": {
      // 兑换券只免一份，数量为 2 时不应减两份的钱
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

// 券为什么用不上：结构化原因码直接进输出，既让用户看懂，也方便排查。
export function couponUnusableReason(coupon, menu, subtotal, today = null) {
  if (!coupon || !coupon.type) {
    return { code: "FIELD_MISSING", message: "券响应里没有类型或优惠金额字段，本地算不出优惠" };
  }
  if (today && coupon.validUntil && String(coupon.validUntil) < String(today)) {
    return { code: "COUPON_EXPIRED", message: `券已于 ${coupon.validUntil} 过期` };
  }
  if (coupon.type === "free_item" && coupon.target) {
    if (!menu.some((item) => item.id === coupon.target)) {
      return { code: "ITEM_NOT_LISTED", message: "券的目标商品本店未在售" };
    }
  }
  if (coupon.type === "free_item" && !coupon.target) {
    return { code: "FIELD_MISSING", message: "兑换券没有指定适用商品" };
  }
  if (coupon.type === "threshold_off" || coupon.type === "percent_off") {
    const minSpend = coupon.minSpend ?? 0;
    if (subtotal > 0 && subtotal < minSpend) {
      return { code: "THRESHOLD_NOT_MET", message: `未达到 ¥${minSpend} 使用门槛（本单原价 ¥${round2(subtotal)}）` };
    }
  }
  return null;
}

function candidatePool(menu, category, prefer, couponTargets) {
  const pool = menu.filter((item) => item.category === category && Number.isFinite(item.price) && item.price > 0);
  if (!pool.length) return [];
  pool.sort(
    (a, b) =>
      Number(prefer(b)) - Number(prefer(a)) ||
      a.price - b.price ||
      (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0),
  );
  const picked = pool.slice(0, TOP_K);
  // 最便宜的商品保底进候选：偏好项都超预算时，枚举仍能找到预算内的替代
  const cheapest = pool.reduce((a, b) => (a.price <= b.price ? a : b));
  if (!picked.includes(cheapest)) picked.push(cheapest);
  // 券指定的商品必须进候选，否则「有券却选不到那个菜」
  for (const item of pool) {
    if (couponTargets.has(item.id) && !picked.includes(item)) picked.push(item);
  }
  return picked;
}

// 超预算时按契约依次砍掉末尾分类（饮料 → 小食），因此按「完整前缀 → 逐步截短」枚举。
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

function preferredCount(items, prefer) {
  return items.reduce((count, item) => count + Number(Boolean(prefer(item))), 0);
}

function better(next, current, optimize, prefer) {
  if (!current) return true;
  if (optimize === "calories") {
    if (next.kcal !== current.kcal) return next.kcal > current.kcal;
    if (next.total !== current.total) return next.total < current.total;
    if (next.units !== current.units) return next.units < current.units;
    return next.subtotal < current.subtotal;
  }
  if (optimize === "value") {
    const nextValue = next.total > 0 ? next.kcal / next.total : 0;
    const currentValue = current.total > 0 ? current.kcal / current.total : 0;
    if (Math.abs(nextValue - currentValue) > 1e-9) return nextValue > currentValue;
    return next.total < current.total;
  }
  // cost（默认）：保持原有行为——先比搭配意图，再比实付，再比省下的金额，最后比原价
  const nextPref = preferredCount(next.items, prefer);
  const currentPref = preferredCount(current.items, prefer);
  if (nextPref !== currentPref) return nextPref > currentPref;
  if (next.total !== current.total) return next.total < current.total;
  if (next.saved !== current.saved) return next.saved > current.saved;
  return next.subtotal < current.subtotal;
}

// 在给定券集合与预算下搜索最优组合。optimize 决定取舍函数，其余约束一视同仁。
function search(menu, coupons, limit, { prefer, optimize, maxItems, maxPerItem, requireCategories = [] }) {
  const couponTargets = new Set(
    coupons.filter((c) => c.type === "free_item" && c.target && c.remaining !== 0).map((c) => c.target),
  );
  const categories = CATEGORY_ORDER.filter((category) =>
    menu.some((item) => item.category === category && Number.isFinite(item.price) && item.price > 0),
  );
  if (!categories.length) throw new Error("菜单为空，无法组合");

  const pools = categories.map((category) => candidatePool(menu, category, prefer, couponTargets));
  const qtyOptions = [];
  for (let q = 1; q <= Math.max(1, Math.min(maxPerItem, maxItems)); q++) qtyOptions.push(q);
  const slots = pools.map((pool) => {
    const arr = [];
    for (const item of pool) for (const qty of qtyOptions) arr.push({ ...item, qty });
    return arr;
  });

  const evaluate = (items) => {
    const subtotal = round2(items.reduce((sum, item) => sum + item.price * item.qty, 0));
    const deal = bestCoupon(items, subtotal, coupons);
    const saved = deal?.saved ?? 0;
    let kcal = 0;
    let unknownUnits = 0;
    let units = 0;
    for (const item of items) {
      units += item.qty;
      if (Number.isFinite(item.kcal)) kcal += item.kcal * item.qty;
      else unknownUnits += item.qty;
    }
    return {
      items,
      subtotal,
      deal,
      saved: round2(saved),
      total: round2(Math.max(0, subtotal - saved)),
      kcal: round2(kcal),
      unknownUnits,
      units,
    };
  };

  let chosen = null;
  for (const prefix of categoryPrefixes(categories)) {
    // 必须包含的分类不能靠截短前缀来绕过：不满足就换下一个更短/更长的前缀
    if (requireCategories.some((category) => !prefix.includes(category))) continue;
    const slotsForPrefix = slots.slice(0, prefix.length);
    let bestInPrefix = null;
    for (const combo of product(slotsForPrefix)) {
      const candidate = evaluate(combo);
      if (candidate.units > maxItems) continue;
      if (candidate.total > limit) continue;
      if (better(candidate, bestInPrefix, optimize, prefer)) bestInPrefix = candidate;
    }
    if (bestInPrefix) {
      chosen = bestInPrefix;
      break;
    }
  }

  // 没有任何前缀能塞进预算：保留最便宜的主食，标记超预算
  if (!chosen) {
    const cheapest = pools[0].reduce((a, b) => (a.price <= b.price ? a : b));
    chosen = evaluate([{ ...cheapest, qty: 1 }]);
    chosen.infeasible = true;
  }
  return chosen;
}

function mergeItems(items) {
  const out = [];
  const index = new Map();
  for (const item of items) {
    const key = item.id;
    if (index.has(key)) {
      index.get(key).qty += item.qty;
      continue;
    }
    const copy = { id: item.id, name: item.name, price: item.price, category: item.category, qty: item.qty };
    if (Number.isFinite(item.kcal)) copy.kcal = item.kcal;
    index.set(key, copy);
    out.push(copy);
  }
  return out;
}

function itemAmountLine(item) {
  return `${item.name} ¥${item.price}${item.qty > 1 ? `×${item.qty}` : ""}`;
}

function sanityNotices(items, subtotal) {
  const notices = [];
  if (!items.some((item) => item.category === "main")) {
    notices.push({ code: "SANITY_NO_STAPLE", message: "这套组合没有主食，只有小食和饮品" });
  }
  // 只盯「同一件商品被重复点、且占了这单一半以上金额」这种荒谬解；
  // 正常套餐里主食总是最贵的一项，不该被这条规则误报。
  const repeated = items.filter((item) => item.qty > 1);
  if (subtotal > 0 && repeated.length) {
    const top = repeated.reduce((a, b) => (a.price * a.qty >= b.price * b.qty ? a : b));
    if ((top.price * top.qty) / subtotal > 0.5) {
      notices.push({
        code: "SANITY_REPEAT_DOMINANT",
        message: `${top.name} 点了 ${top.qty} 份，占了这单金额的一半以上，确认一下是不是真要这么多`,
      });
    }
  }
  return notices;
}

function buildAlternatives(menu, coupons, limit, opts, chosen, optimize) {
  const alternatives = [];
  const measurable = menu.filter((item) => Number.isFinite(item.kcal));
  const sameAs = (candidate, target) =>
    candidate.items.length === target.length &&
    candidate.items.every((item, i) => item.id === target[i].id && item.qty === target[i].qty);
  for (const mode of OPTIMIZE_MODES) {
    if (mode === optimize) continue;
    // 热量类备选没有足够热量数据就没有意义，直接不给，避免拿 0 kcal 冒充
    if (mode !== "cost" && measurable.length < 3) continue;
    const candidate = search(menu, coupons, limit, { ...opts, optimize: mode });
    if (!candidate) continue;
    // 与当前方案或已列出的备选相同就不再重复展示
    if (sameAs(candidate, chosen.items)) continue;
    if (alternatives.some((alt) => sameAs(candidate, alt.items))) continue;
    const diffTotal = round2(candidate.total - chosen.total);
    const diffKcal = round2(candidate.kcal - chosen.kcal);
    const parts = [];
    if (Math.abs(diffTotal) >= 0.005) parts.push(`${diffTotal > 0 ? "多花" : "省下"} ¥${Math.abs(diffTotal)}`);
    if (diffKcal > 0) parts.push(`+${diffKcal} kcal`);
    else if (diffKcal < 0) parts.push(`${diffKcal} kcal`);
    if (!parts.length) parts.push(`共 ${candidate.units} 件`);
    alternatives.push({
      label: OPTIMIZE_LABEL[mode],
      items: mergeItems(candidate.items),
      itemsText: candidate.items.map(itemAmountLine).join(" + "),
      subtotal: candidate.subtotal,
      total: candidate.total,
      saved: candidate.saved,
      coupon: candidate.deal ? { id: candidate.deal.coupon.id, name: candidate.deal.coupon.name, type: candidate.deal.coupon.type } : null,
      kcal: candidate.kcal,
      unknownUnits: candidate.unknownUnits,
      note: parts.join("，"),
    });
  }
  return alternatives.slice(0, 2);
}

/**
 * 计算点餐组合。
 *
 * @param {Array} menu 菜单项 {id,name,price,category,kcal?}
 * @param {Array} coupons 券 {id,name,type,target?,percent?,minSpend?,amount?,validUntil?,remaining?}
 * @param {number} budget 预算（Infinity 表示不限）
 * @param {object} options
 *   prefer: (item) => boolean        搭配意图（套餐/薯条/可乐优先）
 *   optimize: cost | calories | value 优化目标，默认 cost
 *   couponMode: auto | off | pick     用券模式，默认 auto
 *   couponId: pick 模式下指定券的 ID 或名称
 *   excludeCoupons: string[]          排除的券 ID
 *   maxItems: number                 总件数上限，默认 4
 *   maxPerItem: number               单商品份数上限，默认 2
 *   today: "YYYY-MM-DD"              判断过期的基准日（不传则不判过期）
 */
export function planCombo(menu, coupons = [], budget = Infinity, options = {}) {
  const limit = Number.isFinite(budget) ? budget : Infinity;
  const prefer = options.prefer ?? (() => false);
  const optimize = OPTIMIZE_MODES.includes(options.optimize) ? options.optimize : "cost";
  const couponMode = COUPON_MODES.includes(options.couponMode) ? options.couponMode : "auto";
  const exclude = new Set(options.excludeCoupons ?? []);
  const maxItems = positiveInt(options.maxItems, DEFAULT_MAX_ITEMS);
  const maxPerItem = positiveInt(options.maxPerItem, DEFAULT_MAX_PER_ITEM);
  const today = options.today ?? null;
  const requireCategories = (options.requireCategories ?? []).filter((category) => CATEGORY_ORDER.includes(category));
  const searchOptions = { prefer, optimize, maxItems, maxPerItem, requireCategories };

  const notices = [];
  const usable = coupons.filter((coupon) => !exclude.has(coupon.id) && coupon.remaining !== 0);
  let active = usable;
  let picked = null;

  if (couponMode === "off") {
    active = [];
  } else if (couponMode === "pick") {
    const wanted = String(options.couponId ?? "").trim();
    picked =
      usable.find((coupon) => coupon.id === wanted) ??
      usable.find((coupon) => coupon.name === wanted) ??
      (wanted ? usable.find((coupon) => String(coupon.name ?? "").includes(wanted)) : null);
    if (picked) active = [picked];
    else {
      active = [];
      notices.push({
        code: "COUPON_NOT_FOUND",
        message: wanted ? `没有找到「${wanted}」这张券，已按不用券计算；可改用自动模式再算一次` : "指定用券模式但没给券 ID，已按不用券计算",
      });
    }
  }

  // 热量类目标只能比较「有官方热量」的商品：官方营养表用单品名，
  // 而菜单大头是套餐/精选/随心选（实测只有 17~24% 能被匹配）。
  // 把未知当 0 会让优化系统性偏向恰好有数据的商品，等于给错建议，
  // 所以显式收缩候选集，并把「只在子集里优化」写进输出。
  let candidateMenu = menu;
  if (optimize !== "cost") {
    const label = OPTIMIZE_LABEL[optimize];
    const measurable = menu.filter((item) => Number.isFinite(item.kcal) && Number.isFinite(item.price) && item.price > 0);
    const measurableMains = measurable.filter((item) => item.category === "main").length;
    if (measurable.length < 3 || measurableMains < 1) {
      throw new Error(
        `只有 ${measurable.length} 款餐品能匹配到官方热量数据（主食 ${measurableMains} 款），无法按「${label}」目标计算，请改用 cost 目标`,
      );
    }
    notices.push({
      code: "CALORIE_SUBSET",
      message: `「${label}」只比较有官方热量的 ${measurable.length} 款餐品，其余商品热量未知、不参与比较`,
    });
    candidateMenu = measurable;
  }

  const chosen = search(candidateMenu, active, limit, searchOptions);
  if (chosen.infeasible && requireCategories.length) {
    notices.push({
      code: "REQUIRE_UNSATISFIED",
      message: `预算 ¥${limit} 内凑不出「必须含 ${requireCategories.map((category) => CATEGORY_LABEL[category]).join("、")}」的组合，已改为只给最便宜的主食`,
    });
  }
  if (chosen.infeasible && candidateMenu !== menu) {
    throw new Error(`在有官方热量的餐品里找不到预算 ¥${limit} 以内的组合，请放宽预算或改用 cost 目标`);
  }
  const baseline = couponMode === "off" ? null : search(candidateMenu, [], limit, searchOptions);

  if (picked && !chosen.deal) {
    const reason = couponUnusableReason(picked, menu, chosen.subtotal, today) ?? {
      code: "NOT_APPLICABLE",
      message: "这张券对当前组合不产生优惠",
    };
    notices.push({
      code: reason.code,
      message: `指定的券「${picked.name}」未生效：${reason.message}。已按不用券计算，可改用自动模式或换一张`,
    });
  }

  let ignoredCoupon = null;
  if (couponMode === "off" && usable.length) {
    const best = bestCoupon(chosen.items, chosen.subtotal, usable);
    ignoredCoupon = best ? { name: best.coupon.name, saving: best.saved } : null;
    notices.push({
      code: "COUPON_IGNORED",
      message: `另有 ${usable.length} 张券可用${ignoredCoupon ? `，最划算那张能省 ¥${ignoredCoupon.saving}` : ""}（已按你的设置忽略）`,
    });
  }

  // 凑单陷阱：用券方案的总价可能高于「最优不用券方案」——两种原因：
  //   a) 为了够门槛而凑单（原价被推高）；
  //   b) 券让「更大的一餐」变得可负担，件数变多、总价变高。
  // 两种情况都必须显式说明，绝不出现「悄悄更贵」的推荐。
  let extraCostForCoupon = 0;
  let netSaving = round2(chosen.saved);
  const cheaperWithoutCoupon = Boolean(baseline && baseline.total < chosen.total - 1e-9);
  if (baseline && chosen.saved > 0 && chosen.subtotal > baseline.subtotal) {
    extraCostForCoupon = round2(chosen.subtotal - baseline.subtotal);
    netSaving = round2(chosen.saved - extraCostForCoupon);
    notices.push({
      code: "EXTRA_SPEND",
      message:
        netSaving >= 0
          ? `为用这张券多花 ¥${extraCostForCoupon}，券省 ¥${chosen.saved}，净省 ¥${netSaving}`
          : `为用这张券多花 ¥${extraCostForCoupon}，券只省 ¥${chosen.saved}，净亏 ¥${Math.abs(netSaving)}`,
    });
    if (netSaving < 0) {
      notices.push({ code: "COUPON_NOT_WORTH_IT", message: "这张券算下来并不划算，可以改用不用券方案" });
    } else if (extraCostForCoupon > chosen.saved / 2) {
      notices.push({ code: "EXTRA_SPEND_HIGH", message: "⚠ 多花的钱已超过优惠额的一半，这张券未必划算" });
    }
  }
  if (cheaperWithoutCoupon && extraCostForCoupon === 0) {
    notices.push({
      code: "CHEAPER_WITHOUT_COUPON",
      message: `不用券 ¥${baseline.total}（${baseline.units} 件）比本方案 ¥${chosen.total}（${chosen.units} 件）便宜，差额主要来自件数`,
    });
  }

  const items = mergeItems(chosen.items);
  notices.push(...sanityNotices(items, chosen.subtotal));

  return {
    items,
    itemsText: chosen.items.map(itemAmountLine).join(" + "),
    subtotal: chosen.subtotal,
    coupon: chosen.deal ? { id: chosen.deal.coupon.id, name: chosen.deal.coupon.name, type: chosen.deal.coupon.type } : null,
    saved: chosen.saved,
    netSaving,
    total: chosen.total,
    budget: Number.isFinite(budget) ? budget : null,
    overBudget: chosen.total > limit,
    infeasible: Boolean(chosen.infeasible),
    optimize,
    couponMode,
    extraCostForCoupon,
    cheaperWithoutCoupon,
    ignoredCoupon,
    baseline: baseline
      ? {
          itemsText: baseline.items.map(itemAmountLine).join(" + "),
          subtotal: baseline.subtotal,
          total: baseline.total,
          kcal: baseline.kcal,
          units: baseline.units,
          unknownUnits: baseline.unknownUnits,
        }
      : null,
    alternatives: buildAlternatives(candidateMenu, active, limit, searchOptions, chosen, optimize),
    stats: {
      kcal: chosen.kcal,
      unknownUnits: chosen.unknownUnits,
      units: chosen.units,
      categories: [...new Set(chosen.items.map((item) => item.category))].map((category) => CATEGORY_LABEL[category]),
    },
    notices,
  };
}
