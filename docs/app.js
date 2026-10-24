import { planCombo, OPTIMIZE_LABEL } from "./core/combo-core.mjs";

const OPTIMIZE_OPTIONS = [
  ["cost", "最省", "预算内配齐一餐，能把券用掉就用掉"],
  ["calories", "最顶饱", "同样预算下热量最高（只比官方数据）"],
  ["value", "最划算", "每花 1 元换到的热量最高"],
];
const COUPON_MODE_OPTIONS = [
  ["auto", "自动挑券"],
  ["off", "不用券"],
];
const REQUIRE_OPTIONS = [
  ["main", "主食"],
  ["side", "小食"],
  ["drink", "饮品"],
];
const BUDGET_CHIPS = [15, 20, 30, 50];
const MAX_ITEM_CHIPS = [2, 3, 4, 5];
const DEFAULT_BANNER = "示例门店菜单 + 官方热量（非实时）。券里标「虚构」的是演示券，只用于演示用券计算。";
const BADGE = { main: "🍔", side: "🍟", drink: "🥤" };

const $ = (id) => document.getElementById(id);
const state = {
  data: null,
  stores: [],
  storeId: null,
  budget: 30,
  optimize: "cost",
  couponMode: "auto",
  requireCategories: [],
  avoid: [],
  maxItems: 4,
  exclude: [],
  picks: {},
  custom: null,
  lastPlan: null,
};

boot();

async function boot() {
  try {
    const data = await fetch("./data/stores.json", { cache: "no-cache" }).then((response) => response.json());
    state.data = data;
    state.stores = data.stores ?? [];
  } catch (error) {
    renderError(`示例数据加载失败：${error.message}`);
    return;
  }
  if (!state.stores.length) {
    renderError("示例数据为空");
    return;
  }

  const params = new URLSearchParams(location.search);
  const wanted = params.get("s");
  state.storeId = state.stores.some((store) => store.id === wanted) ? wanted : state.stores[0].id;

  renderStores();
  renderBudgetChips();
  renderGoals();
  renderCouponModes();
  renderRequire();
  renderMaxItems();
  renderStats();
  applyParams(params);
  bindEvents();
  compute();
}

/* ---------------- 左侧控件 ---------------- */

function renderStores() {
  $("stores").innerHTML = state.stores
    .map(
      (store) => `<button class="store" type="button" data-store="${escapeHtml(store.id)}" aria-pressed="${
        store.id === state.storeId ? "true" : "false"
      }">
        <span class="dot"></span>
        <span>
          <span class="name">${escapeHtml(store.label)}</span><br />
          <span class="sub">${escapeHtml(store.scene ?? "到店自取")} · ${store.menu.length} 款在售 · ${officialKcal(
            store,
          )} 款有官方热量</span>
        </span>
      </button>`,
    )
    .join("");
}

function renderBudgetChips() {
  $("budget-chips").innerHTML = BUDGET_CHIPS.map(
    (value) => `<button class="chip" type="button" data-budget="${value}" aria-pressed="${state.budget === value}">¥${value}</button>`,
  ).join("");
}

function renderGoals() {
  $("goals").innerHTML = OPTIMIZE_OPTIONS.map(
    ([value, label, desc], index) => `<button class="goal" type="button" data-goal="${value}" aria-pressed="${state.optimize === value}">
      <span class="ico">${["💸", "🍔", "⚖️"][index]}</span>
      <span><span class="t">${label}</span><br /><span class="d">${desc}</span></span>
    </button>`,
  ).join("");
}

function renderCouponModes() {
  $("coupon-modes").innerHTML = COUPON_MODE_OPTIONS.map(
    ([value, label]) => `<button class="chip" type="button" data-coupon-mode="${value}" aria-pressed="${state.couponMode === value}">${label}</button>`,
  ).join("");
}

function renderRequire() {
  $("require").innerHTML = REQUIRE_OPTIONS.map(
    ([value, label]) => `<button class="chip" type="button" data-require="${value}" aria-pressed="${state.requireCategories.includes(value)}">${label}</button>`,
  ).join("");
}

function renderMaxItems() {
  $("max-items").innerHTML = MAX_ITEM_CHIPS.map(
    (value) => `<button class="chip" type="button" data-max="${value}" aria-pressed="${state.maxItems === value}">${value} 件</button>`,
  ).join("");
}

function renderStats() {
  const store = currentStore();
  const nutrition = state.data?.nutrition ?? {};
  const chips = [
    `${store.menu.length} 款在售`,
    `${officialKcal(store)} 款有官方热量`,
    `${store.menu.filter((item) => item.combo).length} 款套餐可换单品`,
    `热量源：接口 ${nutrition.mcp ?? "?"} 项 + 官网计算器 ${nutrition.calculator ?? "?"} 条`,
  ];
  $("stats").innerHTML = chips.map((text) => `<span class="tag">${escapeHtml(text)}</span>`).join("");
}

// 官方热量 = 不是「同类推算」的那些（营养表 / 官网计算器 / 套餐子项累加 / 饮用水记 0）
const officialKcal = (store) => store.menu.filter((item) => Number.isFinite(item.kcal) && item.kcalSource !== "estimate").length;

function bindEvents() {
  $("stores").addEventListener("click", (event) => {
    const button = event.target.closest("[data-store]");
    if (!button) return;
    state.storeId = button.dataset.store;
    state.exclude = [];
    state.picks = {};
    renderStores();
    renderStats();
    compute();
  });
  $("goals").addEventListener("click", (event) => {
    const button = event.target.closest("[data-goal]");
    if (!button) return;
    state.optimize = button.dataset.goal;
    renderGoals();
    compute();
  });
  $("coupon-modes").addEventListener("click", (event) => {
    const button = event.target.closest("[data-coupon-mode]");
    if (!button) return;
    state.couponMode = button.dataset.couponMode;
    renderCouponModes();
    compute();
  });
  $("require").addEventListener("click", (event) => {
    const button = event.target.closest("[data-require]");
    if (!button) return;
    const value = button.dataset.require;
    state.requireCategories = state.requireCategories.includes(value)
      ? state.requireCategories.filter((item) => item !== value)
      : [...state.requireCategories, value];
    renderRequire();
    compute();
  });
  $("max-items").addEventListener("click", (event) => {
    const button = event.target.closest("[data-max]");
    if (!button) return;
    state.maxItems = Number(button.dataset.max);
    renderMaxItems();
    compute();
  });
  $("budget-chips").addEventListener("click", (event) => {
    const button = event.target.closest("[data-budget]");
    if (!button) return;
    state.budget = Number(button.dataset.budget);
    $("budget").value = String(state.budget);
    renderBudgetChips();
    syncBudgetFill();
    compute();
  });
  $("budget").addEventListener("input", () => {
    state.budget = Number($("budget").value);
    renderBudgetChips();
    syncBudgetFill();
    compute();
  });
  $("avoid").addEventListener("input", () => {
    state.avoid = $("avoid")
      .value.split(/[,，、\s]+/)
      .map((word) => word.trim())
      .filter(Boolean);
    compute();
  });
  $("source-toggle").addEventListener("change", () => {
    $("custom-json").classList.toggle("hidden", !$("source-toggle").checked);
    if (!$("source-toggle").checked) {
      state.custom = null;
      $("banner").textContent = DEFAULT_BANNER;
      renderStats();
      compute();
    } else if ($("custom-json").value.trim()) {
      applyCustom();
    }
  });
  $("custom-json").addEventListener("change", applyCustom);

  // 「换一换」：套餐内换单品，价格与热量立刻重算
  $("result").addEventListener("change", (event) => {
    const select = event.target.closest("select[data-swap-item]");
    if (!select) return;
    const itemId = select.dataset.swapItem;
    const roundIndex = Number(select.dataset.swapRound);
    state.picks[itemId] = { ...(state.picks[itemId] ?? {}), [roundIndex]: select.value };
    compute();
  });
  // 券的启用/停用
  $("result").addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-coupon-toggle]");
    if (!toggle) return;
    const id = toggle.dataset.couponToggle;
    state.exclude = state.exclude.includes(id) ? state.exclude.filter((x) => x !== id) : [...state.exclude, id];
    compute();
  });
}

function syncBudgetFill() {
  const min = Number($("budget").min);
  const max = Number($("budget").max);
  const percent = ((state.budget - min) / (max - min)) * 100;
  $("budget").style.setProperty("--fill", `${Math.max(0, Math.min(100, percent))}%`);
  $("budget-value").textContent = String(state.budget);
}

/* ---------------- 自定义菜单 ---------------- */

function applyCustom() {
  const raw = $("custom-json").value.trim();
  if (!raw) return;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    renderError(`JSON 解析失败：${error.message}`);
    return;
  }
  const items = parsed.items ?? parsed.menu ?? [];
  if (!Array.isArray(items) || !items.length) {
    renderError("items 必须是非空数组");
    return;
  }
  const invalid = items.find(
    (item) => !item.id || !item.name || !Number.isFinite(Number(item.price)) || !["main", "side", "drink"].includes(item.category),
  );
  if (invalid) {
    renderError(`商品字段不合法：${JSON.stringify(invalid)}（需要 id / name / price / category，category 取 main|side|drink）`);
    return;
  }
  state.custom = {
    id: "custom",
    label: "我导入的菜单",
    scene: "本地",
    menu: items.map((item) => ({
      id: String(item.id),
      name: String(item.name),
      price: Number(item.price),
      category: item.category,
      ...(Number.isFinite(Number(item.kcal)) ? { kcal: Number(item.kcal) } : {}),
    })),
    coupons: Array.isArray(parsed.coupons) ? parsed.coupons : [],
  };
  state.picks = {};
  $("banner").textContent = "正在用你导入的菜单计算，数据不离开浏览器。";
  renderStats();
  compute();
}

function currentStore() {
  return state.custom ?? state.stores.find((store) => store.id === state.storeId) ?? state.stores[0];
}

/* ---------------- 计算 ---------------- */

function compute() {
  const store = currentStore();
  if (!store) return;

  let menu = store.menu;
  if (state.avoid.length) {
    menu = menu.filter((item) => !state.avoid.some((word) => item.name.includes(word)));
    if (!menu.length) {
      renderError(`忌口「${state.avoid.join("、")}」把这家门店的餐品全过滤掉了，换个词试试`);
      return;
    }
  }

  let plan;
  try {
    plan = planCombo(menu, store.coupons ?? [], state.budget, {
      optimize: state.optimize,
      couponMode: state.couponMode,
      excludeCoupons: state.exclude,
      maxItems: state.maxItems,
      requireCategories: state.requireCategories,
      picks: state.picks,
      today: new Date().toISOString().slice(0, 10),
    });
  } catch (error) {
    renderError(error.message);
    return;
  }
  state.lastPlan = plan;
  renderPlan(plan, store);
  writeParams();
}

/* ---------------- 渲染 ---------------- */

function renderPlan(plan, store) {
  const sections = [];
  sections.push(`<div class="result-head">
      <h2>算出来的方案</h2>
      <span class="hint">${escapeHtml(store.label)} · 目标「${escapeHtml(OPTIMIZE_LABEL[state.optimize])}」· ${plan.stats.units} 件</span>
    </div>`);

  sections.push(renderPicked(plan));
  const swaps = renderSwaps(plan);
  if (swaps) sections.push(swaps);
  const alternatives = renderAlternatives(plan);
  if (alternatives) sections.push(alternatives);
  sections.push(renderCoupons(plan, store));
  const notices = renderNotices(plan);
  if (notices) sections.push(notices);

  $("result").innerHTML = sections.join("");
}

function kcalText(item) {
  if (!Number.isFinite(item.kcal)) return "热量未知";
  if (item.kcalSource === "estimate") return `≈ ${item.kcal} kcal`;
  return `${item.kcal} kcal`;
}

function kcalNote(item) {
  const bits = [];
  if (item.kcalSource === "composition") bits.push("套餐子项累加");
  if (item.kcalSource === "estimate") bits.push(item.kcalLabel ?? "同类推算");
  if (item.kcalAssume) bits.push(item.kcalAssume);
  return bits.join("，");
}

function renderPicked(plan) {
  const items = plan.items
    .map((item) => {
      const note = kcalNote(item);
      const est = item.kcalSource === "estimate";
      return `<div class="item">
        <div class="badge">${BADGE[item.category] ?? "🍽️"}</div>
        <div>
          <div class="name">${escapeHtml(item.name)}${item.qty > 1 ? ` ×${item.qty}` : ""}</div>
          <div class="note">${est ? '<span class="est">' : ""}${escapeHtml(kcalText(item))}${est ? "</span>" : ""}${
            note ? ` · ${escapeHtml(note)}` : ""
          }</div>
        </div>
        <div class="price">¥${money(item.price * item.qty)}</div>
      </div>`;
    })
    .join("");

  const net = plan.netSaving;
  const netLine = net == null || !plan.coupon ? "" : net >= 0 ? ` · 净省 ¥${money(net)}` : ` · 净多花 ¥${money(-net)}`;
  const savedLine = plan.coupon
    ? `<div class="pay under">券省 ¥${money(plan.saved)}${netLine}</div>`
    : `<div class="pay under">未用券</div>`;

  const facts = [
    ["原价", `¥${money(plan.subtotal)}`],
    ["实付", `¥${money(plan.total)}`, "red"],
    ["预算", plan.budget == null ? "不限" : `¥${money(plan.budget)}`],
    [
      "热量",
      plan.stats.kcal > 0
        ? `${plan.stats.kcal} kcal${plan.stats.unknownUnits ? `（${plan.stats.unknownUnits} 件未知）` : ""}`
        : "未知",
    ],
    ["件数", `${plan.stats.units} 件`],
    plan.overBudget ? ["提示", "超预算", "red"] : ["省下", plan.coupon ? `¥${money(plan.saved)}` : "—", "green"],
  ]
    .map(
      ([key, value, tone]) =>
        `<div class="fact"><div class="k">${key}</div><div class="v ${tone ?? ""}">${escapeHtml(String(value))}</div></div>`,
    )
    .join("");

  return `<div class="card picked">
      <div class="picked-top">
        <div class="left">
          <div class="kicker">推荐组合</div>
          <div class="combo-name">${escapeHtml(plan.itemsText)}</div>
        </div>
        <div class="pay">
          <div class="amount"><small>¥</small>${money(plan.total)}</div>
          ${savedLine}
        </div>
      </div>
      <div class="items">${items}</div>
      <div class="facts">${facts}</div>
    </div>`;
}

// 套餐可换单品（随心配、三件套、含杯型的饮料…）：每一轮一个下拉
function renderSwaps(plan) {
  const targets = plan.items.filter((item) => item.combo?.rounds?.length);
  if (!targets.length) return "";
  const blocks = targets
    .map((item) => {
      const rows = item.combo.rounds
        .map((round, index) => {
          const options = round.choices
            .map((choice) => {
              const extra = choice.diffPrice ? ` ${choice.diffPrice > 0 ? "+" : "-"}¥${Math.abs(choice.diffPrice)}` : "";
              const kcal = Number.isFinite(choice.kcal) ? ` · ${choice.kcal} kcal` : "";
              const selected = choice.code === (state.picks[item.id]?.[index] ?? round.picked) ? " selected" : "";
              return `<option value="${escapeHtml(choice.code)}"${selected}>${escapeHtml(choice.name)}${kcal}${extra}</option>`;
            })
            .join("");
          return `<div class="row"><span>${escapeHtml(round.name)}</span><select data-swap-item="${escapeHtml(item.id)}" data-swap-round="${index}">${options}</select></div>`;
        })
        .join("");
      return `<div class="row" style="margin-top: 8px"><span style="color: var(--ink)">${escapeHtml(item.name)}</span></div>${rows}`;
    })
    .join("");
  return `<div class="card swap"><div style="padding: 12px 20px 4px">
      <details open>
        <summary>换单品：这份套餐里的每一样都能换</summary>
        <div class="rows">${blocks}<p class="empty" style="margin: 2px 0 0; font-size: 12px">换单品会同时改这份套餐的价格和热量。</p></div>
      </details>
    </div></div>`;
}

function renderAlternatives(plan) {
  const alts = (plan.alternatives ?? []).filter((alt) => alt.itemsText);
  if (!alts.length) return "";
  return `<div>
      <p class="section-title">还想要别的？</p>
      <div class="alts">${alts
        .map(
          (alt) => `<div class="alt">
            <div class="lbl">${escapeHtml(alt.label)}</div>
            <div class="txt">${escapeHtml(alt.itemsText)}</div>
            <div class="row"><span class="money">¥${money(alt.total)}</span><span class="kc">${
              alt.kcal > 0 ? `${alt.kcal} kcal` : "热量未知"
            }</span></div>
          </div>`,
        )
        .join("")}</div>
    </div>`;
}

function renderCoupons(plan, store) {
  const coupons = store.coupons ?? [];
  if (!coupons.length) {
    return `<div class="card card-pad"><p class="section-title">可用券</p><p class="empty" style="margin: 0">这家店没查到券（示例数据只保留了展示字段）。</p></div>`;
  }
  const usedId = plan.coupon?.id;
  const list = coupons
    .map((coupon) => {
      const off = state.exclude.includes(coupon.id);
      const flags = [
        coupon.id === usedId ? "★ 已用" : "",
        coupon.demo ? "虚构演示券" : "",
        coupon.targetOnSale === false ? "目标商品未在售" : "",
      ].filter(Boolean);
      const detail = [coupon.appliesTo ? `限 ${coupon.appliesTo}` : "", coupon.validUntil ? `至 ${coupon.validUntil}` : ""]
        .filter(Boolean)
        .join("，");
      return `<div class="coupon ${coupon.id === usedId ? "used" : ""}" style="${off ? "opacity:.5" : ""}">
        <div>
          <div class="nm">${escapeHtml(coupon.name)}</div>
          <div class="dt">${escapeHtml(detail || "全部商品")}${flags.length ? ` · ${escapeHtml(flags.join(" · "))}` : ""}</div>
        </div>
        <button class="chip" type="button" data-coupon-toggle="${escapeHtml(coupon.id)}" aria-pressed="${!off}" style="margin-left: auto; flex: none">${
          off ? "启用" : "停用"
        }</button>
      </div>`;
    })
    .join("");
  return `<div class="card card-pad"><p class="section-title">可用券</p><div class="list">${list}</div></div>`;
}

function renderNotices(plan) {
  const notices = plan.notices ?? [];
  if (!notices.length) return "";
  const rows = notices
    .map((notice) => {
      const warn = /^SANITY|WORTH_IT|EXTRA_SPEND|CHEAPER_WITHOUT_COUPON|REQUIRE_UNSATISFIED|COUPON_NOT_FOUND|COUPON_IGNORED|THRESHOLD_NOT_MET/.test(
        notice.code,
      );
      return `<div class="notice ${warn ? "warn" : ""}"><span class="code">${escapeHtml(notice.code)}</span><span>${escapeHtml(notice.message)}</span></div>`;
    })
    .join("");
  return `<div class="card card-pad"><p class="section-title">算的时候注意到这些</p>${rows}</div>`;
}

function renderError(message) {
  $("result").innerHTML = `<div class="result-head"><h2>算出来的方案</h2></div><div class="err">${escapeHtml(message)}</div>`;
}

/* ---------------- URL 同步 ---------------- */

function writeParams() {
  const params = new URLSearchParams();
  if (state.budget !== 30) params.set("b", String(state.budget));
  if (!state.custom) params.set("s", state.storeId);
  if (state.optimize !== "cost") params.set("o", state.optimize);
  if (state.couponMode !== "auto") params.set("c", state.couponMode);
  if (state.exclude.length) params.set("x", state.exclude.join(","));
  if (state.avoid.length) params.set("a", state.avoid.join(","));
  if (state.maxItems !== 4) params.set("m", String(state.maxItems));
  if (state.requireCategories.length) params.set("r", state.requireCategories.join(","));
  const picks = Object.entries(state.picks)
    .map(([id, map]) => `${id}~${Object.entries(map).map(([round, code]) => `${round}=${code}`).join("|")}`)
    .join(";");
  if (picks) params.set("p", picks);
  const query = params.toString();
  history.replaceState(null, "", query ? `?${query}` : location.pathname);
}

function applyParams(params) {
  if (params.has("b")) {
    state.budget = Number(params.get("b")) || 30;
    $("budget").value = String(state.budget);
  }
  if (params.has("m")) state.maxItems = Number(params.get("m")) || 4;
  if (params.has("a")) {
    state.avoid = params
      .get("a")
      .split(/[,，、]/)
      .map((word) => word.trim())
      .filter(Boolean);
    $("avoid").value = params.get("a");
  }
  const optimize = params.get("o");
  if (optimize && OPTIMIZE_OPTIONS.some(([value]) => value === optimize)) state.optimize = optimize;
  const couponMode = params.get("c");
  if (couponMode && COUPON_MODE_OPTIONS.some(([value]) => value === couponMode)) state.couponMode = couponMode;
  const require = params.get("r");
  if (require) state.requireCategories = require.split(",").filter((value) => REQUIRE_OPTIONS.some(([item]) => item === value));
  const excluded = params.get("x");
  if (excluded) state.exclude = excluded.split(",").filter(Boolean);
  const picks = params.get("p");
  if (picks) {
    for (const chunk of picks.split(";")) {
      const [id, rest] = chunk.split("~");
      if (!id || !rest) continue;
      const map = {};
      for (const pair of rest.split("|")) {
        const [round, code] = pair.split("=");
        if (round != null && code) map[Number(round)] = code;
      }
      state.picks[id] = map;
    }
  }
  syncBudgetFill();
  renderBudgetChips();
  renderGoals();
  renderCouponModes();
  renderRequire();
  renderMaxItems();
}

const money = (value) => {
  const n = Math.round(Number(value) * 100) / 100;
  return Number.isInteger(n) ? String(n) : String(n);
};
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
