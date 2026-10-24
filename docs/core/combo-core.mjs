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

function candidatePool(menu, category, prefer, couponTargets, pinSet) {
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
  // 用户自己换过单品的套餐必须留在候选里，否则一换就被优化器换掉别的东西
  for (const item of pool) {
    if (pinSet?.has(item.id) && !picked.includes(item)) picked.push(item);
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
function search(menu, coupons, limit, { prefer, optimize, maxItems, maxPerItem, requireCategories = [], pinItems = [] }) {
  const couponTargets = new Set(
    coupons.filter((c) => c.type === "free_item" && c.target && c.remaining !== 0).map((c) => c.target),
  );
  const pinSet = new Set(pinItems.map(String));
  const pinned = [
    ...new Set(pinItems.map(String).filter((id) => menu.some((item) => String(item.id) === id))),
  ];
  const categories = CATEGORY_ORDER.filter((category) =>
    menu.some((item) => item.category === category && Number.isFinite(item.price) && item.price > 0),
  );
  if (!categories.length) throw new Error("菜单为空，无法组合");

  const pools = categories.map((category) => candidatePool(menu, category, prefer, couponTargets, pinSet));
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
  const hasAllPinned = (items) => pinned.every((id) => items.some((item) => String(item.id) === id));
  const pick = (requirePinned) => {
    for (const prefix of categoryPrefixes(categories)) {
      // 必须包含的分类不能靠截短前缀来绕过：不满足就换下一个更短/更长的前缀
      if (requireCategories.some((category) => !prefix.includes(category))) continue;
      const slotsForPrefix = slots.slice(0, prefix.length);
      let bestInPrefix = null;
      for (const combo of product(slotsForPrefix)) {
        if (requirePinned && !hasAllPinned(combo)) continue;
        const candidate = evaluate(combo);
        if (candidate.units > maxItems) continue;
        if (candidate.total > limit) continue;
        if (better(candidate, bestInPrefix, optimize, prefer)) bestInPrefix = candidate;
      }
      if (bestInPrefix) return bestInPrefix;
    }
    return null;
  };

  // 用户手动换过单品的套餐优先留在方案里；确实放不下（预算不够/件数超限）再退回普通搜索
  chosen = pick(true);
  if (!chosen && pinned.length) {
    chosen = pick(false);
    if (chosen) chosen.pinDropped = pinned;
  }
  if (!chosen) chosen = pick(false);

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
    // 热量来源要带出去：界面上估算值必须显示成「≈」，不能和官方数据长得一样
    if (item.kcalSource) copy.kcalSource = item.kcalSource;
    if (item.kcalLabel) copy.kcalLabel = item.kcalLabel;
    if (item.kcalAssume) copy.kcalAssume = item.kcalAssume;
    // 可选配的套餐（随心配、三件套…）带上轮次，界面才能「换一换」
    if (item.combo?.rounds?.length) copy.combo = item.combo;
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
 * 「随心配」这类套餐是可以换单品的：官方 query-meal-detail 给出 rounds[]，
 * 每一轮都是一组可换的选项，换的时候按 diffPrice 补差价。
 *
 * 把某一套选择折算成「这份套餐实际多少钱、多少热量」，供界面「换一换」直接重算。
 * 热量只在**每一轮都查得到**时才给数字——有一项查不到就沿用 item.kcal（可能是未知），
 * 不做部分累加。
 *
 * @param {object} item 带 combo.rounds 的商品
 * @param {Object<string|number, string>} pickMap 轮次下标或轮次名 → 选项 code
 */
export function resolveCombo(item, pickMap = {}) {
  const rounds = item.combo?.rounds ?? [];
  if (!rounds.length) return { price: item.price, kcal: item.kcal, picks: {}, parts: [], resolved: Number.isFinite(item.kcal) };

  const defaultDiff = rounds.reduce((sum, round) => {
    const def = round.choices.find((choice) => choice.isDefault) ?? round.choices[0];
    return sum + (Number(def?.diffPrice) || 0);
  }, 0);
  // 菜单上的 price 已经包含默认选择，所以差价要从「默认组合」这个基准算起
  let price = (Number(item.price) || 0) - defaultDiff;
  let kcal = 0;
  let complete = true;
  const picks = {};
  const parts = [];
  let isDefaultSelection = true;

  rounds.forEach((round, index) => {
    const wanted = pickMap[index] ?? pickMap[round.name] ?? round.picked;
    const choice =
      round.choices.find((candidate) => candidate.code === wanted) ??
      round.choices.find((candidate) => candidate.isDefault) ??
      round.choices[0];
    if (!choice) {
      complete = false;
      return;
    }
    const fallback = round.choices.find((candidate) => candidate.isDefault) ?? round.choices[0];
    if (fallback && choice.code !== fallback.code) isDefaultSelection = false;
    picks[index] = choice.code;
    parts.push({ name: choice.name, qty: 1 });
    price += Number(choice.diffPrice) || 0;
    if (Number.isFinite(choice.kcal)) kcal += choice.kcal;
    else complete = false;
  });

  return {
    price: round2(price),
    // 换了单品就算不全：不能用旧的合计冒充新选择的热量（换成一个查不到热量的商品时尤其明显）。
    // 只有「选的和默认完全一样」才允许沿用原有数字。
    kcal: complete ? Math.round(kcal) : isDefaultSelection ? item.kcal : undefined,
    picks,
    parts,
    resolved: complete,
  };
}

/** 把「换单品」的选择应用到整张菜单上（价格与热量都跟着变） */
export function applyPicks(menu, picks = {}) {
  if (!picks || !Object.keys(picks).length) return menu;
  return menu.map((item) => {
    if (!item.combo?.rounds?.length) return item;
    const chosen = picks[item.id];
    if (!chosen) return item;
    const { price, kcal, picks: resolvedPicks } = resolveCombo(item, chosen);
    return { ...item, price, kcal, combo: { ...item.combo, picked: resolvedPicks } };
  });
}

/**
 * 计算点餐组合。
 *
 * @param {Array} menu 菜单项 {id,name,price,category,kcal?,combo?}
 * @param {Array} coupons 券 {id,name,type,target?,percent?,minSpend?,amount?,validUntil?,remaining?}
 * @param {number} budget 预算（Infinity 表示不限）
 * @param {object} options
 *   prefer: (item) => boolean        搭配意图（套餐/薯条/可乐优先）
 *   optimize: cost | calories | value 优化目标，默认 cost
 *   couponMode: auto | off | pick     用券模式，默认 auto
 *   couponId: pick 模式下指定券的 ID 或名称
 *   excludeCoupons: string[]          排除的券 ID
 *   picks: {itemId: {roundIndex: code}} 套餐内已换好的单品
 *   maxItems: number                 总件数上限，默认 4
 *   maxPerItem: number               单商品份数上限，默认 2
 *   today: "YYYY-MM-DD"              判断过期的基准日（不传则不判过期）
 */
export function planCombo(menu, coupons = [], budget = Infinity, options = {}) {
  const limit = Number.isFinite(budget) ? budget : Infinity;
  menu = applyPicks(menu, options.picks);
  const prefer = options.prefer ?? (() => false);
  const optimize = OPTIMIZE_MODES.includes(options.optimize) ? options.optimize : "cost";
  const couponMode = COUPON_MODES.includes(options.couponMode) ? options.couponMode : "auto";
  const exclude = new Set(options.excludeCoupons ?? []);
  const maxItems = positiveInt(options.maxItems, DEFAULT_MAX_ITEMS);
  const maxPerItem = positiveInt(options.maxPerItem, DEFAULT_MAX_PER_ITEM);
  const today = options.today ?? null;
  const requireCategories = (options.requireCategories ?? []).filter((category) => CATEGORY_ORDER.includes(category));
  const pinItems = options.pinItems ?? Object.keys(options.picks ?? {});
  const searchOptions = { prefer, optimize, maxItems, maxPerItem, requireCategories, pinItems };

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

  // 热量类目标只能比较「有可信热量」的商品：官方数据（营养表/官网计算器/套餐子项累加）。
  // 「同类推算」的粗估值不参与排序——拿估算值去比「谁更顶饱」，等于用假精度换结论。
  let candidateMenu = menu;
  if (optimize !== "cost") {
    const label = OPTIMIZE_LABEL[optimize];
    const measurable = menu.filter(
      (item) =>
        Number.isFinite(item.kcal) &&
        Number.isFinite(item.price) &&
        item.price > 0 &&
        item.kcalSource !== "estimate",
    );
    const measurableMains = measurable.filter((item) => item.category === "main").length;
    if (measurable.length < 3 || measurableMains < 1) {
      throw new Error(
        `只有 ${measurable.length} 款餐品能匹配到官方热量数据（主食 ${measurableMains} 款），无法按「${label}」目标计算，请改用 cost 目标`,
      );
    }
    notices.push({
      code: "CALORIE_SUBSET",
      message: `「${label}」只比较有官方热量的 ${measurable.length} 款餐品，其余商品热量未知或为估算、不参与比较`,
    });
    candidateMenu = measurable;
  }

  let chosen = search(candidateMenu, active, limit, searchOptions);
  if (chosen.infeasible && requireCategories.length) {
    notices.push({
      code: "REQUIRE_UNSATISFIED",
      message: `预算 ¥${limit} 内凑不出「必须含 ${requireCategories.map((category) => CATEGORY_LABEL[category]).join("、")}」的组合，已改为只给最便宜的主食`,
    });
  }
  if (chosen.pinDropped?.length) {
    notices.push({
      code: "PIN_DROPPED",
      message: `你换过单品的套餐在 ¥${limit} 预算 / ${maxItems} 件内放不下，这次没带上它`,
    });
  }
  if (chosen.infeasible && candidateMenu !== menu) {
    throw new Error(`在有官方热量的餐品里找不到预算 ¥${limit} 以内的组合，请放宽预算或改用 cost 目标`);
  }
  const baseline = couponMode === "off" ? null : search(candidateMenu, [], limit, searchOptions);

  // cost 目标下绝不给「用券反而更贵」的答案：凑单把原价推高了、券省的钱抵不过多花的钱时，
  // 直接改给不用券的方案（用户要的是省钱，不是把券用掉）。
  // 热量 / 每元热量目标不套这条——多花的钱换的是更多热量，那正是这两个目标本身。
  if (optimize === "cost" && couponMode === "auto" && baseline && chosen.total > baseline.total + 1e-9) {
    notices.push({
      code: "CHEAPER_WITHOUT_COUPON",
      message: `用「${chosen.deal?.coupon?.name ?? "券"}」要 ¥${chosen.total}，比不用券的 ¥${baseline.total} 更贵（凑单把原价推高了），已按不用券给你`,
    });
    chosen = baseline;
  }

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
    // cost 目标下差价只可能是「多花钱换更多件数」，净省一定 >= 0（更贵的情况上面已经换成不用券方案）；
    // 热量类目标里多花的钱换的是更多热量，是目标本身，所以只报差价、不下「不划算」的结论。
    const costMode = optimize === "cost";
    notices.push({
      code: "EXTRA_SPEND",
      message: costMode
        ? netSaving >= 0
          ? `为用这张券多花 ¥${extraCostForCoupon}，券省 ¥${chosen.saved}，净省 ¥${netSaving}`
          : `为用这张券多花 ¥${extraCostForCoupon}，券只省 ¥${chosen.saved}，净亏 ¥${Math.abs(netSaving)}`
        : `为拿到更多${optimize === "calories" ? "热量" : "性价比"}多花 ¥${extraCostForCoupon}，券省 ¥${chosen.saved}；想省钱可看备选里的「最省」`,
    });
    if (costMode && netSaving < 0) {
      notices.push({ code: "COUPON_NOT_WORTH_IT", message: "这张券算下来并不划算，可以改用不用券方案" });
    } else if (costMode && extraCostForCoupon > chosen.saved / 2) {
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
