import { test } from "node:test";
import assert from "node:assert/strict";
import { planCombo, bestCoupon } from "../src/combo.mjs";

const menu = [
  { id: "bigmac", name: "巨无霸", price: 24, category: "main" },
  { id: "mchicken", name: "麦香鸡", price: 15, category: "main" },
  { id: "fries", name: "中薯", price: 11, category: "side" },
  { id: "sundae", name: "小薯", price: 7, category: "side" },
  { id: "coke", name: "中可", price: 9, category: "drink" },
  { id: "water", name: "纯水", price: 4, category: "drink" },
];

test("无券时给出最便宜的 主食+小食+饮料 组合", () => {
  const plan = planCombo(menu);
  assert.deepEqual(plan.items.map((i) => i.id), ["mchicken", "sundae", "water"]);
  assert.equal(plan.subtotal, 26);
  assert.equal(plan.total, 26);
  assert.equal(plan.coupon, null);
});

test("免费兑换券命中组合内单品时零元", () => {
  const coupons = [{ id: "c1", name: "麦香鸡免费兑换券", type: "free_item", target: "mchicken" }];
  const plan = planCombo(menu, coupons);
  assert.equal(plan.saved, 15);
  assert.equal(plan.total, 11);
});

test("预算不够时依次砍掉饮料和小食", () => {
  assert.deepEqual(planCombo(menu, [], 24).items.map((i) => i.id), ["mchicken", "sundae"]);
  assert.deepEqual(planCombo(menu, [], 20).items.map((i) => i.id), ["mchicken"]);
  assert.equal(planCombo(menu, [], 20).total, 15);
  assert.equal(planCombo(menu, [], 10).overBudget, true);
});

test("按门槛满减和折扣券里挑省得多的那张", () => {
  const subtotal = 26;
  const coupons = [
    { id: "t", name: "满20减3", type: "threshold_off", minSpend: 20, amount: 3 },
    { id: "p", name: "9折", type: "percent_off", percent: 10 },
  ];
  const best = bestCoupon([], subtotal, coupons);
  assert.equal(best.coupon.id, "t");
  assert.equal(best.saved, 3);
});

test("券没用上时不返回券", () => {
  const coupons = [{ id: "t", name: "满40减10", type: "threshold_off", minSpend: 40, amount: 10 }];
  assert.equal(planCombo(menu, coupons, 20).coupon, null);
});

test("免费兑换券指定贵价商品时，优先选包含它的组合", () => {
  const coupons = [{ id: "c1", name: "巨无霸免费兑换券", type: "free_item", target: "bigmac" }];
  const plan = planCombo(menu, coupons);
  assert.deepEqual(plan.items.map((i) => i.id), ["bigmac", "sundae", "water"]);
  assert.equal(plan.saved, 24);
  assert.equal(plan.total, 11);
});

test("券指定商品不在最便宜前三时也会进入候选", () => {
  const manyMains = [
    { id: "m1", name: "A", price: 5, category: "main" },
    { id: "m2", name: "B", price: 6, category: "main" },
    { id: "m3", name: "C", price: 7, category: "main" },
    { id: "target", name: "贵堡", price: 40, category: "main" },
    { id: "s1", name: "薯", price: 7, category: "side" },
    { id: "d1", name: "可乐", price: 4, category: "drink" },
  ];
  const coupons = [{ id: "c1", name: "贵堡免费兑换券", type: "free_item", target: "target" }];
  const plan = planCombo(manyMains, coupons);
  assert.ok(plan.items.some((i) => i.id === "target"));
  assert.equal(plan.saved, 40);
  assert.equal(plan.total, 11);
});

test("折扣券与满减券竞争时全局选更省的组合", () => {
  const coupons = [
    { id: "p", name: "9折", type: "percent_off", percent: 10 },
    { id: "t", name: "满20减3", type: "threshold_off", minSpend: 20, amount: 3 },
  ];
  const plan = planCombo(menu, coupons);
  // 最便宜组合 26 元：满20减3 省 3，9折省 2.6 → 用满减
  assert.equal(plan.coupon.id, "t");
  assert.equal(plan.total, 23);
});

test("偏好命中数优先于价格，但只在预算内生效", () => {
  const menu2 = [
    { id: "cheap", name: "普通汉堡", price: 10, category: "main" },
    { id: "combo", name: "超值套餐", price: 22, category: "main" },
    { id: "s1", name: "中薯条", price: 11, category: "side" },
    { id: "d1", name: "中杯可乐", price: 9, category: "drink" },
  ];
  const prefer = (item) => /套餐|薯条|可乐/.test(item.name);
  // 预算 45：3 项全命中的偏好组合（42）胜过高命中数更低的便宜组合（30）
  const rich = planCombo(menu2, [], 45, { prefer });
  assert.deepEqual(rich.items.map((i) => i.id), ["combo", "s1", "d1"]);
  assert.equal(rich.total, 42);
  // 预算 25：偏好组合超预算 → 降级为预算内答案（普通汉堡+中薯条=21）
  const tight = planCombo(menu2, [], 25, { prefer });
  assert.ok(tight.total <= 25);
  assert.deepEqual(tight.items.map((i) => i.id), ["cheap", "s1"]);
});
