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
