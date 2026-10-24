import { planCombo, OPTIMIZE_LABEL } from "./core/combo-core.mjs";

const OPTIMIZE_OPTIONS = [
  ["cost", "最省"],
  ["calories", "最顶饱"],
  ["value", "每元热量最高"],
];
const COUPON_MODES = [
  ["auto", "自动挑最划算"],
  ["off", "完全不用券"],
];
const REQUIRE_OPTIONS = [
  ["side", "含小食"],
  ["drink", "含饮品"],
];
const BUDGET_CHIPS = [15, 20, 30, 50, 80];
const DEFAULT_BANNER = "示例门店菜单 + 官方热量（非实时）。券里标「虚构」的是演示券，只用于演示用券计算。";

const $ = (id) => document.getElementById(id);
const state = { data: null, stores: [], storeId: null, custom: null, lastPlan: null };

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
  const params = new URLSearchParams(location.search);
  const wanted = params.get("s");
  state.storeId = state.stores.some((store) => store.id === wanted) ? wanted : state.stores[0]?.id;

  buildStoreSelect();
  buildRadios("optimize", "optimize", OPTIMIZE_OPTIONS, "cost");
  buildRadios("coupon-mode", "couponMode", COUPON_MODES, "auto");
  buildRadios("require", "require", REQUIRE_OPTIONS, null, true);
  buildBudgetChips();
  applyParams(params);
  bindEvents();
  refreshCoupons();
  compute();
}

function buildStoreSelect() {
  $("store").innerHTML = state.stores
    .map((store) => `<option value="${store.id}">${escapeHtml(store.label)}</option>`)
    .join("");
  $("store").value = state.storeId;
}

function buildRadios(containerId, name, options, fallback, multi = false) {
  $(containerId).innerHTML = options
    .map(([value, label], index) => {
      const type = multi ? "checkbox" : "radio";
      const checked = !multi && (value === fallback || (fallback == null && index === 0)) ? "checked" : "";
      return `<label><input type="${type}" name="${name}" value="${value}" ${checked} />${escapeHtml(label)}</label>`;
    })
    .join("");
}

function buildBudgetChips() {
  $("budget-chips").innerHTML = BUDGET_CHIPS.map((value) => `<button class="chip" type="button" data-budget="${value}">¥${value}</button>`).join("");
}

function bindEvents() {
  const recompute = () => compute();
  for (const id of ["budget", "avoid", "max-items"]) $(id).addEventListener("input", recompute);
  $("store").addEventListener("change", () => {
    state.storeId = $("store").value;
    refreshCoupons();
    compute();
  });
  for (const name of ["optimize", "couponMode", "require"]) {
    document.querySelectorAll(`input[name="${name}"]`).forEach((input) => input.addEventListener("change", recompute));
  }
  $("budget-chips").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-budget]");
    if (!chip) return;
    $("budget").value = chip.dataset.budget;
    compute();
  });
  $("apply-custom").addEventListener("click", applyCustom);
  $("reset-custom").addEventListener("click", () => {
    state.custom = null;
    $("custom-json").value = "";
    $("banner").textContent = DEFAULT_BANNER;
    refreshCoupons();
    compute();
  });
}

// 粘贴自定义数据：只接受 {items, coupons}，校验后立刻参与计算，不写入 URL
function applyCustom() {
  let parsed;
  try {
    parsed = JSON.parse($("custom-json").value);
  } catch (error) {
    renderError(`JSON 解析失败：${error.message}`);
    return;
  }
  const items = parsed.items ?? parsed.menu ?? [];
  if (!Array.isArray(items) || !items.length) {
    renderError("items 必须是非空数组");
    return;
  }
  const invalid = items.find((item) => !item.id || !item.name || !Number.isFinite(Number(item.price)) || !["main", "side", "drink"].includes(item.category));
  if (invalid) {
    renderError(`商品字段不合法：${JSON.stringify(invalid)}（需要 id / name / price / category，category 取 main|side|drink）`);
    return;
  }
  state.custom = {
    id: "custom",
    label: "我导入的菜单",
    menu: items.map((item) => ({
      id: String(item.id),
      name: String(item.name),
      price: Number(item.price),
      category: item.category,
      ...(Number.isFinite(Number(item.kcal)) ? { kcal: Number(item.kcal) } : {}),
    })),
    coupons: Array.isArray(parsed.coupons) ? parsed.coupons : [],
  };
  $("banner").textContent = "正在使用你导入的菜单数据，不涉及任何真实门店信息。";
  refreshCoupons();
  compute();
}

function currentStore() {
  return state.custom ?? state.stores.find((store) => store.id === state.storeId) ?? state.stores[0];
}

function refreshCoupons() {
  const store = currentStore();
  const coupons = store?.coupons ?? [];
  if (!coupons.length) {
    $("coupons").innerHTML = '<span class="muted" style="font-size:13px">这家样例门店没有查到可用券</span>';
    return;
  }
  $("coupons").innerHTML = coupons
    .map((coupon) => {
      const detail = [
        coupon.demo ? "虚构的演示券" : "",
        coupon.appliesTo && !coupon.demo ? `限 ${escapeHtml(coupon.appliesTo)}` : "",
        coupon.validUntil ? `至 ${escapeHtml(coupon.validUntil)}` : "",
        coupon.targetOnSale === false ? "目标商品本店未在售" : "",
      ]
        .filter(Boolean)
        .join("，");
      const name = escapeHtml(coupon.name);
      return `<label${coupon.demo ? ' title="虚构券，仅用于演示用券计算"' : ""}><input type="checkbox" value="${escapeHtml(coupon.id)}" checked /><span>${name}<br /><small>${detail}</small></span></label>`;
    })
    .join("");
}

function readOptions() {
  const budgetRaw = $("budget").value.trim();
  const budget = budgetRaw === "" ? Infinity : Number(budgetRaw);
  return {
    budget,
    optimize: document.querySelector('input[name="optimize"]:checked')?.value ?? "cost",
    couponMode: document.querySelector('input[name="couponMode"]:checked')?.value ?? "auto",
    requireCategories: [...document.querySelectorAll('input[name="require"]:checked')].map((input) => input.value),
    excludeCoupons: [...document.querySelectorAll("#coupons input")].filter((input) => !input.checked).map((input) => input.value),
    avoid: $("avoid")
      .value.split(/[,，、\s]+/)
      .map((word) => word.trim())
      .filter(Boolean),
    maxItems: Math.min(6, Math.max(1, Number($("max-items").value) || 4)),
  };
}

function compute() {
  const store = currentStore();
  if (!store) return;
  const options = readOptions();
  if (!Number.isFinite(options.budget) && options.budget !== Infinity) {
    renderError("预算必须是不小于 0 的数字");
    return;
  }
  if (options.budget < 0) {
    renderError("预算必须是不小于 0 的数字");
    return;
  }

  let menu = store.menu;
  if (options.avoid.length) {
    menu = menu.filter((item) => !options.avoid.some((word) => item.name.includes(word)));
    if (!menu.length) {
      renderError(`忌口「${options.avoid.join("、")}」把这家门店的餐品全过滤掉了，换个词试试`);
      return;
    }
  }

  let plan;
  try {
    plan = planCombo(menu, store.coupons ?? [], options.budget, {
      optimize: options.optimize,
      couponMode: options.couponMode,
      couponId: undefined,
      excludeCoupons: options.excludeCoupons,
      maxItems: options.maxItems,
      requireCategories: options.requireCategories,
    });
  } catch (error) {
    renderError(error.message);
    return;
  }
  state.lastPlan = plan;
  renderPlan(plan, options);
  writeParams(options);
}

function renderPlan(plan, options) {
  const budgetText = plan.budget == null ? "不限" : `¥${plan.budget}`;
  const items = plan.items
    .map((item) => {
      const kcal = Number.isFinite(item.kcal) ? `${item.kcal} kcal` : "热量未知";
      return `<li><span>${escapeHtml(item.name)}${item.qty > 1 ? ` ×${item.qty}` : ""}<br /><span class="meta">${kcal}</span></span><span>¥${money(item.price * item.qty)}</span></li>`;
    })
    .join("");

  const lines = [];
  lines.push(
    `<div class="line">原价 ¥${money(plan.subtotal)}　预算 ${budgetText}${
      plan.coupon ? `　券 −¥${money(plan.saved)}（${escapeHtml(plan.coupon.name)}）` : ""
    }${plan.overBudget ? '　<b class="bad">超预算</b>' : ""}</div>`,
  );

  if (plan.stats.unknownUnits === 0 && plan.stats.kcal > 0) {
    lines.push(`<div class="line">热量合计 <b>${plan.stats.kcal} kcal</b>（官方营养数据）</div>`);
  } else if (plan.stats.kcal > 0) {
    lines.push(
      `<div class="line">热量合计 <b>${plan.stats.kcal} kcal</b>，另有 ${plan.stats.unknownUnits} 件查不到官方热量，未计入</div>`,
    );
  } else {
    lines.push('<div class="line muted">这份组合查不到官方热量数据，不做估算</div>');
  }

  if (plan.baseline && plan.coupon) {
    lines.push(
      `<div class="line">对照：不用券 ${escapeHtml(plan.baseline.itemsText)}，实付 ¥${money(plan.baseline.total)}</div>`,
    );
  }
  if (plan.ignoredCoupon) {
    lines.push(`<div class="line warn">已按你的设置忽略全部券；最划算的「${escapeHtml(plan.ignoredCoupon.name)}」本可省 ¥${money(plan.ignoredCoupon.saving)}</div>`);
  }
  for (const alternative of plan.alternatives ?? []) {
    lines.push(
      `<div class="line">备选（${escapeHtml(alternative.label)}）：${escapeHtml(alternative.itemsText)}，实付 ¥${money(alternative.total)}（${escapeHtml(alternative.note)}）</div>`,
    );
  }
  for (const notice of plan.notices ?? []) {
    const kind = /^SANITY|WORTH_IT|EXTRA_SPEND_HIGH|REQUIRE_UNSATISFIED/.test(notice.code) ? "warn" : "";
    lines.push(`<div class="line ${kind}">${escapeHtml(notice.message)}</div>`);
  }

  $("result").innerHTML = `
    <h2>算出来的方案</h2>
    <div class="result-total"><b>¥${money(plan.total)}</b><span>实付${plan.coupon ? ` · 已用「${escapeHtml(plan.coupon.name)}」` : " · 未用券"}</span></div>
    <ul class="items">${items}</ul>
    <div class="lines">${lines.join("")}</div>
    <p class="muted" style="margin-top:14px;font-size:12.5px">
      目标：${escapeHtml(OPTIMIZE_LABEL[options.optimize] ?? options.optimize)}　件数：${plan.stats.units}
      ${plan.stats.categories.length ? `　分类：${plan.stats.categories.map(escapeHtml).join(" / ")}` : ""}
    </p>
  `;
  markUsedCoupon(plan.coupon?.id);
}

function markUsedCoupon(usedId) {
  document.querySelectorAll("#coupons label").forEach((label) => {
    const input = label.querySelector("input");
    const used = input && input.value === usedId;
    label.style.background = used ? "#fff8e6" : "";
    label.style.borderRadius = "7px";
  });
}

function renderError(message) {
  $("result").innerHTML = `<h2>算出来的方案</h2><div class="line bad err">${escapeHtml(message)}</div>`;
}

function writeParams(options) {
  const params = new URLSearchParams();
  if (Number.isFinite(options.budget)) params.set("b", String(options.budget));
  if (!state.custom && state.storeId) params.set("s", state.storeId);
  if (options.optimize !== "cost") params.set("o", options.optimize);
  if (options.couponMode !== "auto") params.set("c", options.couponMode);
  if (options.excludeCoupons.length) params.set("x", options.excludeCoupons.join(","));
  if (options.avoid.length) params.set("a", options.avoid.join(","));
  if (options.maxItems !== 4) params.set("m", String(options.maxItems));
  if (options.requireCategories.length) params.set("r", options.requireCategories.join(","));
  const query = params.toString();
  history.replaceState(null, "", query ? `?${query}` : location.pathname);
}

function applyParams(params) {
  if (params.has("b")) $("budget").value = params.get("b");
  if (params.has("m")) $("max-items").value = params.get("m");
  if (params.has("a")) $("avoid").value = params.get("a");
  const optimize = params.get("o");
  if (optimize) {
    const input = document.querySelector(`input[name="optimize"][value="${optimize}"]`);
    if (input) input.checked = true;
  }
  const couponMode = params.get("c");
  if (couponMode) {
    const input = document.querySelector(`input[name="couponMode"][value="${couponMode}"]`);
    if (input) input.checked = true;
  }
  const require = params.get("r");
  if (require) {
    for (const value of require.split(",")) {
      const input = document.querySelector(`input[name="require"][value="${value}"]`);
      if (input) input.checked = true;
    }
  }
  const excluded = params.get("x");
  if (excluded) {
    // 券列表在 refreshCoupons 之后才有，延后执行
    requestAnimationFrame(() => {
      for (const id of excluded.split(",")) {
        const input = document.querySelector(`#coupons input[value="${id}"]`);
        if (input) input.checked = false;
      }
      compute();
    });
  }
}

const money = (value) => (Math.round(value * 100) / 100).toFixed(2).replace(/\.00$/, "");
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
