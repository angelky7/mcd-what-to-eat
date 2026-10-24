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
