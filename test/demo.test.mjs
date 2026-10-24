import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { planCombo } from "../src/core/combo-core.mjs";

const readText = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Demo 用的核心与 src 保持同一份（防漂移）", async () => {
  const [source, copy] = await Promise.all([
    readText("../src/core/combo-core.mjs"),
    readText("../docs/core/combo-core.mjs"),
  ]);
  assert.equal(copy, source, "docs/core/combo-core.mjs 与 src 不一致，请运行 npm run demo:sync");
});

test("Demo 页面与脚本存在且没有 CDN 依赖", async () => {
  const [html, app] = await Promise.all([readText("../docs/index.html"), readText("../docs/app.js")]);
  assert.match(html, /type="module" src="\.\/app\.js"/);
  assert.ok(!/https?:\/\/cdn/.test(html), "不应依赖 CDN");
  assert.ok(!/<script[^>]+src="https?:/.test(html), "不应从外域加载脚本");
  assert.match(app, /from "\.\/core\/combo-core\.mjs"/);
});

test("Demo 数据可用，且不含券码等敏感字段", async () => {
  const raw = await readText("../docs/data/stores.json");
  const data = JSON.parse(raw);
  assert.ok(Array.isArray(data.stores) && data.stores.length >= 1);
  assert.ok(!raw.includes("couponCode"), "演示数据里不能出现券码");
  assert.ok(!raw.includes("storeCode"), "演示数据里不能出现真实门店编码");
  for (const store of data.stores) {
    assert.ok(store.menu.length > 10, `${store.id} 菜单太小`);
    for (const item of store.menu) {
      assert.ok(["main", "side", "drink"].includes(item.category), `${item.name} 分类非法`);
      assert.ok(Number.isFinite(item.price) && item.price > 0, `${item.name} 价格非法`);
    }
  }
});

test("示例门店是北京与上海，不放佛山的店", async () => {
  const data = JSON.parse(await readText("../docs/data/stores.json"));
  for (const store of data.stores) {
    assert.ok(!/佛山/.test(store.label), `${store.label} 还是佛山的店`);
    assert.match(store.label, /北京|上海|广州|深圳|杭州/, "示例门店应该是常见的一线城市");
  }
});

test("演示数据里带官方热量来源标记，估算值不会被当成官方数据", async () => {
  const data = JSON.parse(await readText("../docs/data/stores.json"));
  const allowed = new Set(["mcp", "calculator", "composition", "definition", "estimate"]);
  for (const store of data.stores) {
    const measured = store.menu.filter((item) => Number.isFinite(item.kcal));
    assert.ok(measured.length > store.menu.length * 0.8, `${store.id} 有热量的商品太少`);
    for (const item of measured) {
      assert.ok(allowed.has(item.kcalSource), `${item.name} 的热量来源非法：${item.kcalSource}`);
    }
    // 官方来源（不含 estimate）要占到大头
    const official = measured.filter((item) => item.kcalSource !== "estimate").length;
    assert.ok(official >= measured.length * 0.5, `${store.id} 官方热量的比例太低`);
  }
});

test("随心配这类套餐在演示数据里带可选轮次，且能换", async () => {
  const data = JSON.parse(await readText("../docs/data/stores.json"));
  const withCombo = data.stores.flatMap((store) => store.menu).filter((item) => item.combo?.rounds?.length);
  assert.ok(withCombo.length > 5, "应该有多个可换单品的套餐");
  const suixinpei = withCombo.find((item) => /随心配/.test(item.name));
  assert.ok(suixinpei, "示例数据里应该有随心配");
  for (const round of suixinpei.combo.rounds) {
    assert.ok(round.choices.length > 1, `${round.name} 只有一个选项，换不了`);
    assert.ok(round.picked, `${round.name} 缺默认选择`);
  }
});

test("每种优化目标都能在演示数据上算出方案", async () => {
  const data = JSON.parse(await readText("../docs/data/stores.json"));
  for (const store of data.stores) {
    for (const optimize of ["cost", "calories", "value"]) {
      const plan = planCombo(store.menu, store.coupons ?? [], 30, { optimize });
      assert.ok(plan.items.length >= 1, `${store.id}/${optimize} 没算出来`);
      assert.ok(plan.total <= 30, `${store.id}/${optimize} 超预算`);
    }
    for (const couponMode of ["auto", "off"]) {
      const plan = planCombo(store.menu, store.coupons ?? [], 30, { couponMode });
      assert.ok(plan.items.length >= 1, `${store.id}/${couponMode} 没算出来`);
    }
  }
});
