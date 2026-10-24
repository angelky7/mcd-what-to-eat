// 热量解析：把「菜单上叫 A、营养表上叫 B」的商品对齐，并给每一级都留下来源痕迹。
//
// 为什么要单独一层：
// - MCP 的 list-nutrition-foods 有 154 项，但菜单上的名字更粗（「薯条」「可乐」「麦辣鸡翅」），
//   营养表上却是「中薯条」「可乐中杯」「麦辣鸡翅-2块」；
// - 官网营养计算器（https://www.mcdonalds.com.cn/nutrition_calculator）另有 132 条，
//   一部分是 MCP 表没有的（麦咖啡、雪冰、早餐），可以互补；
// - 两者都没有的（季节限定/新品），要么靠套餐构成累加，要么按同类商品推算并明确标注「估算」。
//
// 原则：**每一级都记下来源，估算一定带 ≈ 与依据**，绝不把估算值当成官方数据。

export const KCAL_SOURCE = {
  MCP: "mcp", // list-nutrition-foods（官方接口）
  CALCULATOR: "calculator", // 官网营养计算器（官方网页内嵌数据）
  COMPOSITION: "composition", // query-meal-detail 子项累加
  DEFINITION: "definition", // 定义上就没有热量（饮用水）
  ESTIMATE: "estimate", // 同类商品推算
};

export const SOURCE_LABEL = {
  [KCAL_SOURCE.MCP]: "官方营养表",
  [KCAL_SOURCE.CALCULATOR]: "官网营养计算器",
  [KCAL_SOURCE.COMPOSITION]: "套餐子项累加",
  [KCAL_SOURCE.DEFINITION]: "饮用水记 0",
  [KCAL_SOURCE.ESTIMATE]: "同类推算",
};

// 定义上就没有可产能营养素的东西。不是估算：一瓶纯净水热量为 0 是事实，
// 但两个官方源都没有收录「纯悦」，按同类饮料中位数去推会得到 105 kcal，反而错得离谱。
const WATER = /纯悦|饮用水|矿泉水|纯净水|冰露/;

// 菜单名的别名 → 官方名。只做「同一个东西的两种叫法」，不跨品类，不改规格。
const ALIAS = new Map([
  ["可乐", "可口可乐"],
  ["百事可乐", "可口可乐"],
  ["无糖可乐", "无糖可口可乐"],
  ["零度可乐", "无糖可口可乐"],
  ["怡泉", "怡泉+C"],
  ["怡泉C", "怡泉+C"],
  ["苹果汁", "100%苹果汁"],
  ["纯牛奶", "纯牛奶（盒装）"],
  ["牛奶", "牛奶"],
  ["麦旋风", "奥利奥麦旋风"],
  ["新地", "朱古力新地"],
  ["派", "香芋派"],
  ["薯条", "薯条"],
  ["麦乐鸡", "麦乐鸡5块"],
  ["麦辣鸡翅", "麦辣鸡翅-2块"],
  ["鸡翅", "麦辣鸡翅-2块"],
]);

// 单品默认规格：菜单只写「薯条」，门店卖的是中份（¥13.5 对应中薯条）。
// 这是一条**显式的默认假设**，命中后会标 assume，用户可以看得到。
const DEFAULT_SIZE = new Map([
  ["薯条", "中"],
  ["脆脆薯条", "中"],
  ["玉米杯", "小"],
]);

const SIZE_ORDER = ["迷你", "小", "中", "大"];

const TRAILING_QUALIFIER = /(盒装|瓶装|杯装|单件|组合装|单人份)$/;

export function normalizeName(value) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[（）()【】\[\]「」]/g, "")
    .replace(/[™®]/g, "")
    .replace(/[-—–_/]/g, "")
    .replace(/[“”"']/g, "")
    .replace(TRAILING_QUALIFIER, "");
}

// 「中薯条」「大杯玉米杯」「可乐中杯」「迷你新地」「超大薯条」→ { size, base }
// 前后缀都要认：菜单上「中薯条」和营养表上「薯条 中」是同一个东西，只是写法不同。
export function splitSize(rawName) {
  const name = String(rawName ?? "").replace(/\s+/g, "");
  for (const size of SIZE_ORDER) {
    for (const unit of ["杯", "份", "个", ""]) {
      const token = size + unit;
      if (name.startsWith(token) && name.length - token.length >= 2) return { size, base: name.slice(token.length) };
      if (name.endsWith(token) && name.length - token.length >= 2) return { size, base: name.slice(0, name.length - token.length) };
    }
  }
  return { size: null, base: name };
}

function variantOf(variant) {
  // 「1个」「1份」「2块」「5块」「默认」不是规格，是分量；用同一个键收起来
  if (/^\d+(个|份|块|条|杯|只)$/.test(variant) || variant === "默认") return { kind: "portion", key: variant };
  return { kind: "size", key: variant };
}

function pickVariant(list, wantedSize, wantedPortion) {
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const sizes = list.filter((entry) => entry.kind === "size");
  const portions = list.filter((entry) => entry.kind === "portion");
  if (wantedSize) {
    // 原名里就带规格的（「迷你朱古力新地」）优先按原名对，再看通用规格字段
    const byRaw = list.find((entry) => entry.rawSize === wantedSize);
    if (byRaw) return byRaw;
    const exact = sizes.find((entry) => entry.key === wantedSize);
    if (exact) return exact;
  }
  // 没指定规格时，优先「1个/1份」这种整份条目——「朱古力新地」不该被「迷你朱古力新地」顶掉
  if (portions.length) {
    const exact = wantedPortion && portions.find((entry) => entry.key === wantedPortion);
    return exact ?? portions[0];
  }
  if (sizes.length) {
    const byDefault = sizes.find((entry) => entry.key === "中") ?? sizes.find((entry) => entry.key === "小");
    return byDefault ?? sizes[0];
  }
  return list[0];
}

/**
 * 建一个统一的官方热量索引（MCP 营养表 + 官网营养计算器）。
 * @param {{ mcpTable?: Map<string, number>, calculator?: Array<{name,variant,kcal,category}> }} sources
 */
export function createResolver({ mcpTable = new Map(), calculator = [] } = {}) {
  const buckets = new Map(); // 归一化基名 → [{ key, kind, kcal, source, label }]
  const formPool = new Map(); // 形态 → [官方热量]，用于给查不到的项做兜底推算
  const push = (rawName, variant, kcal, source) => {
    if (!Number.isFinite(kcal) || kcal < 0) return;
    const { size, base } = splitSize(rawName);
    // 基名也可能自带分量后缀（「麦乐鸡5块」），再拆一次
    const portion = /^(.*?)(\d+(?:个|份|块|条|杯|只))$/.exec(base);
    const finalBase = normalizeName(portion ? portion[1] : base);
    const finalVariant = portion ? portion[2] : variant ?? size;
    if (!finalBase) return;
    const { kind, key } = variantOf(finalVariant ?? "默认");
    const bucket = buckets.get(finalBase) ?? [];
    bucket.push({
      key: size && !finalVariant ? size : key,
      kind: size && !finalVariant ? "size" : kind,
      rawSize: size,
      kcal,
      source,
      label: `${rawName}（${finalVariant ?? "默认"}）`,
    });
    buckets.set(finalBase, bucket);

    const form = formOf(finalBase);
    if (form) {
      const pool = formPool.get(form) ?? [];
      pool.push(kcal);
      formPool.set(form, pool);
    }
  };

  // 官网营养计算器先进（条目更细，含麦咖啡），MCP 表后进（同名同规格时覆盖，接口字段更权威）
  for (const entry of calculator) push(entry.name, entry.variant, entry.kcal, KCAL_SOURCE.CALCULATOR);
  for (const [name, kcal] of mcpTable) push(name, null, kcal, KCAL_SOURCE.MCP);

  const lookupBucket = (rawName) => {
    const { size, base } = splitSize(rawName);
    const key = normalizeName(base);
    const direct = buckets.get(key);
    if (direct) return { entries: direct, size };
    const alias = ALIAS.get(base) ?? ALIAS.get(key);
    if (alias) {
      const aliased = buckets.get(normalizeName(alias));
      if (aliased) return { entries: aliased, size };
    }
    return null;
  };

  /**
   * @returns {{kcal:number, source:string, label:string, assume?:string}|null}
   */
  const lookup = (rawName) => {
    const hit = lookupBucket(rawName);
    if (!hit) return null;
    const { size, base } = splitSize(rawName);
    const preferred = size ?? DEFAULT_SIZE.get(base) ?? null;
    const entry = pickVariant(hit.entries, preferred, null);
    if (!entry) return null;
    const assumed = !size && entry.kind === "size" ? `按「${entry.key}」份计` : undefined;
    return {
      kcal: Math.round(entry.kcal),
      source: entry.source,
      label: entry.label,
      ...(assumed ? { assume: assumed } : {}),
    };
  };

  /**
   * 只按名字推算（用于套餐子项：子项不在菜单里，拿不到分类）。
   * 组合类/多件装一律不推。
   */
  const estimateByName = (name) => {
    if (NO_ESTIMATE.test(String(name ?? ""))) return null;
    const form = formOf(name);
    const pool = form ? formPool.get(form) : null;
    if (!pool?.length) return null;
    return { kcal: median(pool), label: `${form}同类 ${pool.length} 项中位数` };
  };

  return { lookup, estimateByName, size: buckets.size };
}

// 名字里带这些词的商品，形态相近，可用作推算的参照系
const FORM_RULES = [
  [/汉堡|牛堡|鸡腿堡|麦满分|堡$/, "汉堡"],
  [/卷$|营养卷/, "卷"],
  [/薯条/, "薯条"],
  [/鸡翅|V翅/, "鸡翅"],
  [/脆汁鸡|肉骨鸡|鸡排|炸鸡/, "炸鸡"],
  [/麦乐鸡|鸡块|鸡球/, "鸡块"],
  [/派$/, "派"],
  [/新地/, "新地"],
  [/麦旋风/, "麦旋风"],
  [/咖啡|美式|拿铁|奶铁|卡布奇诺/, "咖啡"],
  [/可乐|雪碧|红茶|果汁|柠柠|纯悦|水$|麦炫酷|奶茶/, "饮料"],
  [/冰淇淋|圆筒/, "冰淇淋"],
];

const formOf = (name) => FORM_RULES.find(([re]) => re.test(name))?.[1] ?? null;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

// 这些名字代表「一份里装了好几样」或「数量不是一件」，热量必须靠子项累加，推算一定离谱。
// 例：「精选单人餐三件套」按一个汉堡的 485 kcal 推算 → 严重低估，宁可标未知。
const NO_ESTIMATE = /套餐|件套|随心|拼盘|分享餐|双人|多人|单人餐|四件|八件|十翅|双拼|全家|桶|任选|组合|加购|乐园餐|四宫格|小食盘/;

/**
 * 同类推算：官方两个源都查不到时，用「同形态 + 同品类」的已知商品中位数兜底。
 * 只对**同形态单品**才推（汉堡推汉堡、饮料推饮料），组合类与多件装一律不推——宁缺勿编。
 * @param {{name:string, category:string}} item
 * @param {Array<{name:string, category:string, kcal:number}>} known
 */
export function estimateKcal(item, known) {
  if (NO_ESTIMATE.test(item.name)) return null;
  const form = formOf(item.name);
  const pool = known.filter(
    (other) =>
      Number.isFinite(other.kcal) &&
      other.category === item.category &&
      (form ? formOf(other.name) === form : true),
  );
  if (pool.length < 1) return null;
  const value = median(pool.map((other) => other.kcal));
  return {
    kcal: value,
    source: KCAL_SOURCE.ESTIMATE,
    label: `${form ?? "同类"} ${pool.length} 件商品的中位数`,
    basis: pool.slice(0, 4).map((other) => other.name),
  };
}

/**
 * 给商品补热量：官方精确 → 官方规格匹配 → 同类推算。
 * 计算器核心只认 kcal 数字，来源与假设挂在 item 上供输出层披露。
 *
 * @param {Array} items
 * @param {object|Map} source resolver，或旧的「名称→热量」Map（Map 模式不做推算，保持向后兼容）
 */
export function attachCalories(items, source, { estimate } = {}) {
  const legacy = source instanceof Map;
  const resolver = legacy ? createResolver({ mcpTable: source }) : source;
  if (!resolver?.lookup) return items;
  const allowEstimate = estimate ?? !legacy;

  const resolved = items.map((item) => {
    if (Number.isFinite(item.kcal)) return item;
    const hit = resolver.lookup(item.name);
    if (hit) {
      return {
        ...item,
        kcal: hit.kcal,
        kcalSource: hit.source,
        kcalLabel: hit.label,
        ...(hit.assume ? { kcalAssume: hit.assume } : {}),
      };
    }
    if (WATER.test(item.name)) {
      return { ...item, kcal: 0, kcalSource: KCAL_SOURCE.DEFINITION, kcalLabel: "饮用水，热量记 0" };
    }
    return item;
  });
  if (!allowEstimate) return resolved;

  const known = resolved.filter((item) => Number.isFinite(item.kcal));
  return resolved.map((item) => {
    if (Number.isFinite(item.kcal)) return item;
    // 先用「同品类 + 同形态」的菜单内中位数，再退到「全量官方条目 + 同形态」的推算
    const guess = estimateKcal(item, known) ?? resolver.estimateByName?.(item.name);
    if (!guess) return item;
    return {
      ...item,
      kcal: guess.kcal,
      kcalSource: guess.source ?? KCAL_SOURCE.ESTIMATE,
      kcalLabel: guess.label,
      ...(guess.basis ? { kcalBasis: guess.basis } : {}),
    };
  });
}

/**
 * 把「名称→热量」的查询统一成函数：既接受 Map（旧用法），也接受 resolver。
 */
export function asLookup(source) {
  if (typeof source === "function") return source;
  if (source?.lookup) return (name) => source.lookup(name)?.kcal ?? null;
  if (source instanceof Map) {
    const normalized = new Map();
    for (const [name, kcal] of source) normalized.set(normalizeName(name), kcal);
    return (name) => source.get(name) ?? normalized.get(normalizeName(name)) ?? null;
  }
  return () => null;
}

export const __internals = { formOf, median, pickVariant, variantOf };
