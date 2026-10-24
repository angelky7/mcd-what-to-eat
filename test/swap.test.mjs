// 随心配 / 三件套这类「可以换单品」的套餐：换完之后价格与热量都要跟着变，
// 而且不能因为换了一下就被优化器换掉整份套餐。
import test from "node:test";
import assert from "node:assert/strict";
import { planCombo, resolveCombo, applyPicks } from "../src/core/combo-core.mjs";

// 精选超值随心配：蓝区选 1（默认那么大鸡排）+ 粉区选 1（默认怡泉+C麦炫酷）
const suixinpei = {
  id: "9900015568",
  name: "精选超值随心配",
  price: 13.9,
  category: "main",
  kcal: 492,
  kcalSource: "composition",
  combo: {
    rounds: [
      {
        name: "蓝区",
        picked: "521156",
        choices: [
          { code: "521156", name: "那么大鸡排（椒盐风味）", diffPrice: 0, isDefault: true, kcal: 385 },
          { code: "1120", name: "双层吉士汉堡", diffPrice: 1, kcal: 429 },
          { code: "1450", name: "麦香鸡", diffPrice: 0, kcal: 370 },
        ],
      },
      {
        name: "粉区",
        picked: "521336",
        choices: [
          { code: "521336", name: "怡泉+C麦炫酷", diffPrice: 0, isDefault: true, kcal: 107 },
          { code: "3050", name: "可乐中杯", diffPrice: 0, kcal: 147 },
        ],
      },
    ],
  },
};

const side = { id: "s1", name: "中薯条", price: 13.5, category: "side", kcal: 289 };
const drink = { id: "d1", name: "纯悦", price: 9, category: "drink", kcal: 0 };

test("不换单品时用默认选择，价格与热量与菜单一致", () => {
  const resolved = resolveCombo(suixinpei, {});
  assert.equal(resolved.price, 13.9);
  assert.equal(resolved.kcal, 492);
  assert.equal(resolved.resolved, true);
});

test("换单品按差价补钱、热量按新选择重算", () => {
  const resolved = resolveCombo(suixinpei, { 0: "1120" });
  assert.equal(resolved.price, 14.9); // 13.9 + ¥1
  assert.equal(resolved.kcal, 429 + 107);
  assert.equal(resolved.parts[0].name, "双层吉士汉堡");
});

test("两轮都换也算得对", () => {
  const resolved = resolveCombo(suixinpei, { 0: "1450", 1: "3050" });
  assert.equal(resolved.price, 13.9);
  assert.equal(resolved.kcal, 370 + 147);
});

test("换成查不到热量的选项：热量记未知，不拿旧数字冒充", () => {
  const item = structuredClone(suixinpei);
  item.combo.rounds[0].choices.push({ code: "521881", name: "马来咖喱风味薄皮肉骨鸡3块", diffPrice: 1 });
  const resolved = resolveCombo(item, { 0: "521881" });
  assert.equal(resolved.price, 14.9);
  assert.equal(resolved.kcal, undefined);
  assert.equal(resolved.resolved, false);
});

test("applyPicks 把换好的价格与热量写回菜单", () => {
  const menu = applyPicks([suixinpei, side], { "9900015568": { 0: "1120" } });
  assert.equal(menu[0].price, 14.9);
  assert.equal(menu[0].kcal, 536);
  assert.equal(menu[1].price, 13.5); // 没换的商品不动
});

test("换过的套餐不会被优化器换掉：组合里仍然有它", () => {
  const menu = [suixinpei, side, drink];
  const plan = planCombo(menu, [], 40, { picks: { "9900015568": { 0: "1120" } } });
  const hit = plan.items.find((item) => item.id === "9900015568");
  assert.ok(hit, "换过单品的套餐必须留在方案里");
  assert.equal(hit.price, 14.9);
  assert.equal(hit.kcal, 536);
});

test("换完之后结果里的套餐仍带着可换的轮次，界面才能继续换", () => {
  const plan = planCombo([suixinpei, side, drink], [], 40, { picks: { "9900015568": { 1: "3050" } } });
  const hit = plan.items.find((item) => item.id === "9900015568");
  assert.ok(hit.combo?.rounds?.length);
  assert.equal(hit.kcal, 385 + 147);
});

test("预算实在放不下换过的套餐时，退回普通方案并给出原因码", () => {
  const plan = planCombo([suixinpei, side, drink], [], 12, { picks: { "9900015568": { 0: "1120" } } });
  if (!plan.items.some((item) => item.id === "9900015568")) {
    assert.ok(
      plan.notices.some((notice) => notice.code === "PIN_DROPPED"),
      "被放弃时要说明，不能默默换成别的",
    );
  }
});

test("picks 键为空对象等于没换", () => {
  const plan = planCombo([suixinpei, side, drink], [], 40, { picks: {} });
  assert.equal(plan.total > 0, true);
  assert.equal(plan.notices.some((notice) => notice.code === "PIN_DROPPED"), false);
});
