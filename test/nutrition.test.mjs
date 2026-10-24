// 热量解析：官方两个源（MCP 营养表 + 官网营养计算器）如何对齐菜单名，
// 以及「查不到时怎么算」的边界——组合类不许推、饮用水记 0。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createResolver,
  attachCalories,
  estimateKcal,
  normalizeName,
  splitSize,
  KCAL_SOURCE,
} from "../src/nutrition.mjs";

const calculator = JSON.parse(readFileSync(new URL("../data/nutrition-calculator.json", import.meta.url), "utf8")).items;

// 模拟 list-nutrition-foods 的解析结果
const mcpTable = new Map([
  ["中薯条", 289],
  ["大薯条", 379],
  ["小薯条", 210],
  ["可乐中杯", 147],
  ["可乐大杯", 224],
  ["可乐小杯", 107],
  ["麦乐鸡5块", 213],
  ["麦辣鸡翅-2块", 224],
  ["板烧鸡腿堡", 391],
]);

const resolver = createResolver({ mcpTable, calculator });

test("normalizeName 抹平全角括号、空格与连接符", () => {
  assert.equal(normalizeName("100% 苹果汁(盒装)"), "100%苹果汁");
  assert.equal(normalizeName("麦辣鸡翅-2块"), "麦辣鸡翅2块");
  assert.equal(normalizeName("【美汁源】“多汁柠柠”"), "美汁源多汁柠柠");
});

test("splitSize 认出前置/后置规格词", () => {
  assert.deepEqual(splitSize("中薯条"), { size: "中", base: "薯条" });
  assert.deepEqual(splitSize("可乐大杯"), { size: "大", base: "可乐" });
  assert.deepEqual(splitSize("迷你新地"), { size: "迷你", base: "新地" });
  assert.deepEqual(splitSize("板烧鸡腿堡"), { size: null, base: "板烧鸡腿堡" });
});

test("菜单名比营养表粗时按默认规格对齐（薯条 → 中薯条）", () => {
  const hit = resolver.lookup("薯条");
  assert.equal(hit.kcal, 289);
  assert.equal(hit.source, KCAL_SOURCE.MCP);
  assert.match(hit.assume, /中/);
});

test("显式规格不打折（可乐中杯 / 可乐大杯 各查各的）", () => {
  assert.equal(resolver.lookup("可乐中杯").kcal, 147);
  assert.equal(resolver.lookup("可乐大杯").kcal, 224);
  assert.equal(resolver.lookup("可乐大杯").assume, undefined);
});

test("别名能对上官方名，但不会跨品类瞎匹配", () => {
  assert.equal(resolver.lookup("无糖可乐").kcal, 0); // 官网计算器：无糖可口可乐 中杯 0 kcal
  assert.equal(resolver.lookup("那么大鸡排（椒盐风味）").kcal, 385);
  assert.equal(resolver.lookup("完全不存在的商品"), null);
});

test("官网计算器补上了 MCP 表没有的麦咖啡", () => {
  const hit = resolver.lookup("冰美式中杯");
  assert.equal(hit.source, KCAL_SOURCE.CALCULATOR);
  assert.ok(hit.kcal > 0 && hit.kcal < 30);
});

test("组合类一律不推算：宁可标未知也不给假数字", () => {
  const known = [{ id: "x", name: "板烧鸡腿堡", category: "main", kcal: 391 }];
  assert.equal(estimateKcal({ name: "精选单人餐三件套", category: "main" }, known), null);
  assert.equal(estimateKcal({ name: "全明星双人分享餐八件套", category: "main" }, known), null);
  assert.equal(estimateKcal({ name: "BFF四宫格小食盘", category: "main" }, known), null);
});

test("单品查不到时按同形态推算，并标记来源", () => {
  const items = [
    { id: "a", name: "板烧鸡腿堡", price: 23.5, category: "main", kcal: 391 },
    { id: "b", name: "巨无霸", price: 26, category: "main", kcal: 513 },
    { id: "c", name: "某个新堡", price: 25, category: "main" },
  ];
  const out = attachCalories(items, resolver);
  const guessed = out.find((item) => item.id === "c");
  assert.ok(Number.isFinite(guessed.kcal), "应该推算出热量");
  assert.equal(guessed.kcalSource, KCAL_SOURCE.ESTIMATE);
  assert.match(guessed.kcalLabel, /汉堡|中位数/);
});

test("饮用水记 0（不是按饮料中位数推 105）", () => {
  const out = attachCalories([{ id: "w", name: "纯悦", price: 9, category: "drink" }], resolver);
  assert.equal(out[0].kcal, 0);
  // 官网计算器收录了纯悦就是 calculator；没收录时才落到「饮用水记 0」
  assert.ok([KCAL_SOURCE.CALCULATOR, KCAL_SOURCE.DEFINITION].includes(out[0].kcalSource));
});

test("传旧的 Map 时不启用推算，行为与之前一致", () => {
  const items = [{ id: "a", name: "某个新堡", price: 25, category: "main" }];
  const out = attachCalories(items, mcpTable);
  assert.equal(out[0].kcal, undefined);
});

test("官网计算器快照本身是可信的：板烧鸡腿堡 391、中薯条 289、巨无霸 513", () => {
  const byName = new Map(calculator.map((item) => [`${item.name}|${item.variant}`, item.kcal]));
  assert.equal(byName.get("板烧鸡腿堡|1个"), 391);
  assert.equal(byName.get("薯条|中"), 289);
  assert.equal(byName.get("巨无霸|1个"), 513);
});
