import { pathToFileURL } from "node:url";
import { planCombo } from "./core/combo-core.mjs";

// 计算逻辑全部在 core（纯函数、浏览器可复用），这里只保留导出兼容与命令行入口。
export { planCombo, CATEGORY_ORDER, OPTIMIZE_MODES, COUPON_MODES } from "./core/combo-core.mjs";
export { bestCoupon, couponSaving, couponUnusableReason, OPTIMIZE_LABEL } from "./core/combo-core.mjs";
export { resolveCombo, applyPicks } from "./core/combo-core.mjs";

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (match) {
      flags[match[1]] = match[2] ?? true;
      continue;
    }
    positional.push(arg);
  }
  return { positional, flags };
}

function money(value) {
  return `¥${Number.isInteger(value) ? value : value.toFixed(1)}`;
}

// 人类可读输出；要看原始结构加 --json
function render(plan) {
  const lines = [`推荐组合：${plan.itemsText}`];
  const budget = plan.budget ? `｜预算 ${plan.budget}` : "";
  const over = plan.overBudget ? " ⚠ 超预算" : "";
  const target = plan.optimize !== "cost" ? `｜目标 ${plan.optimize}` : "";
  if (plan.coupon) {
    lines.push(`原价 ${money(plan.subtotal)}｜券 -${money(plan.saved)}（${plan.coupon.name}）｜实付 ${money(plan.total)}${budget}${target}${over}`);
  } else {
    lines.push(`原价 ${money(plan.subtotal)}｜实付 ${money(plan.total)}${budget}${target}${over}`);
  }
  if (plan.stats.kcal > 0) {
    const unknown = plan.stats.unknownUnits ? `（${plan.stats.unknownUnits} 件热量未知，未计入）` : "（全部商品均有官方热量数据）";
    lines.push(`热量：合计 ${plan.stats.kcal} kcal${unknown}`);
  }
  if (plan.alternatives.length) {
    lines.push(`备选：${plan.alternatives.map((alt) => `${alt.itemsText} — ${money(alt.total)}`).join(" ／ ")}`);
  }
  for (const notice of plan.notices) lines.push(`${notice.code === "CALORIE_SUBSET" ? "提示" : "注意"}：${notice.message}`);
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [file, budgetArg] = positional;
  if (!file) {
    console.error("用法: node src/combo.mjs <menu.json> [预算] [--optimize=cost|calories|value] [--no-coupon|--coupon=名称] [--json]");
    process.exit(1);
  }
  const { readFile } = await import("node:fs/promises");
  const { items = [], coupons = [] } = JSON.parse(await readFile(file, "utf8"));
  const budget = budgetArg ? Number(budgetArg) : Infinity;
  const couponMode = flags["no-coupon"] ? "off" : flags.coupon ? "pick" : "auto";
  let plan;
  try {
    plan = planCombo(items, coupons, budget, {
      optimize: typeof flags.optimize === "string" ? flags.optimize : "cost",
      couponMode,
      couponId: typeof flags.coupon === "string" ? flags.coupon : undefined,
    });
  } catch (error) {
    console.error(`${error.message}（这份数据里没有 kcal 字段？）`);
    process.exit(1);
  }
  console.log(flags.json ? JSON.stringify(plan, null, 2) : render(plan));
}
