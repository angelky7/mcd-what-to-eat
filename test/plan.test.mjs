import { test } from "node:test";
import assert from "node:assert/strict";
import { couponsFor, extractJson, normalizeMenu, parseBudget, oracleCombo, probePrice, categoryOf, annotateAvailability, pickStore, parseNutrition, attachCalories, parseComposition, enrichCalories, filterAvoid } from "../src/plan.mjs";

test("标题语义兜底：兑换 / 折扣 / 满减 / 立减", () => {
  const coupons = couponsFor({
    data: [
      { couponId: "c1", title: "巨无霸免费兑换券", products: [{ productCode: "9900014838", productName: "巨无霸" }] },
      { couponId: "c2", title: "满 20 减 3" },
      { couponId: "c3", title: "全线 9 折" },
      { couponId: "c4", title: "立减 5 元" },
    ],
  });
  assert.equal(coupons[0].type, "free_item");
  assert.equal(coupons[0].target, "9900014838");
  assert.equal(coupons[0].appliesTo, "巨无霸");
  assert.equal(coupons[1].type, "threshold_off");
  assert.equal(coupons[1].minSpend, 20);
  assert.equal(coupons[1].amount, 3);
  assert.equal(coupons[2].type, "percent_off");
  assert.equal(coupons[2].percent, 10);
  assert.equal(coupons[3].type, "threshold_off");
  assert.equal(coupons[3].minSpend, 0);
  assert.equal(coupons[3].amount, 5);
});

test("结构化字段优先于标题", () => {
  const coupons = couponsFor({
    data: [
      { couponId: "d1", title: "名称无所谓", couponType: "EXCHANGE", products: [{ productCode: "p1", productName: "X" }] },
      { couponId: "d2", title: "名称无所谓", discountType: "percent_off", discount: 0.9, threshold: 30, remaining: 1 },
      { couponId: "d3", title: "名称无所谓", preferentialType: "满减", useThreshold: 50, discountAmount: 12 },
    ],
  });
  assert.equal(coupons[0].type, "free_item");
  assert.equal(coupons[0].target, "p1");
  assert.equal(coupons[1].type, "percent_off");
  assert.equal(coupons[1].percent, 10);
  assert.equal(coupons[1].minSpend, 30);
  assert.equal(coupons[1].remaining, 1);
  assert.equal(coupons[2].type, "threshold_off");
  assert.equal(coupons[2].minSpend, 50);
  assert.equal(coupons[2].amount, 12);
});

test("映射不出类型的券保留展示字段但不参与计算", () => {
  const coupons = couponsFor({ data: [{ couponId: "x", title: "第二件半价" }] });
  assert.equal(coupons[0].type, undefined);
  assert.equal(coupons[0].name, "第二件半价");
});

test("有效期取交易时间段的最后一天", () => {
  const coupons = couponsFor({
    data: [{ couponId: "v", title: "x", tradeDateTime: "2026-10-01 00:00:00 至 2026-10-30 23:59:59" }],
  });
  assert.equal(coupons[0].validUntil, "2026-10-30");
});

test("extractJson 直接解析纯 JSON", () => {
  assert.deepEqual(extractJson('{"success":true,"data":[1]}'), { success: true, data: [1] });
});

test("extractJson 从文本中提取内嵌 JSON", () => {
  const text = '调用成功 {"success":true,"data":{"a":1}} 结束';
  assert.deepEqual(extractJson(text), { success: true, data: { a: 1 } });
});

test("extractJson 正确处理字符串内的花括号与转义引号", () => {
  const text = '结果：{"success":true,"data":{"name":"麦\\"当劳{"}}';
  assert.deepEqual(extractJson(text), { success: true, data: { name: '麦"当劳{' } });
});

test("extractJson 找不到 JSON 时抛错", () => {
  assert.throws(() => extractJson("没有 JSON"), /找不到 JSON/);
});

test("normalizeMenu 按分类名归类并过滤酱料餐具", () => {
  const payload = {
    data: {
      categories: [
        { name: "主食/汉堡", meals: [{ code: "9900014838", tags: [] }] },
        { name: "小食甜品", meals: [{ code: "9900000001", tags: [] }] },
        { name: "饮品", meals: [{ code: "9900000002", tags: [] }] },
        { name: "辅助用品", meals: [{ code: "9900000003", tags: [] }] },
      ],
      meals: {
        "9900014838": { name: "巨无霸", currentPrice: 24, originalPrice: 25.5 },
        "9900000001": { name: "中薯条", currentPrice: 11 },
        "9900000002": { name: "中杯可乐", currentPrice: 9 },
        "9900000003": { name: "番茄酱", currentPrice: 0 },
      },
    },
  };
  const items = normalizeMenu(payload);
  assert.deepEqual(
    items.map((i) => [i.id, i.category]),
    [
      ["9900014838", "main"],
      ["9900000001", "side"],
      ["9900000002", "drink"],
    ],
  );
  assert.equal(items[0].originalPrice, 25.5);
});

test("parseBudget 接受数字与缺省，拒绝非法输入", () => {
  assert.equal(parseBudget("30"), 30);
  assert.equal(parseBudget(undefined), Infinity);
  assert.equal(parseBudget(""), Infinity);
  assert.throws(() => parseBudget("abc"), /不小于 0 的数字/);
  assert.throws(() => parseBudget("-5"), /不小于 0 的数字/);
});

test("categoryOf 分类名无信号时用商品名二次判定", () => {
  // 通用分类（人气热卖）下的促销小吃/饮品不能落进主食
  assert.equal(categoryOf("人气热卖", "心形薯饼8块"), "side");
  assert.equal(categoryOf("人气热卖", "中杯可乐"), "drink");
  assert.equal(categoryOf("人气热卖", "巨无霸"), "main");
  // 分类名有信号时以分类名为准
  assert.equal(categoryOf("炸鸡", "麦乐鸡"), "side");
  assert.equal(categoryOf("麦咖啡™", "燕麦奶铁"), "drink");
  assert.equal(categoryOf("鸡肉汉堡/卷", "麦辣鸡腿汉堡"), "main");
  // 兼容旧调用（只传分类名）
  assert.equal(categoryOf("饮品"), "drink");
  assert.equal(categoryOf("小食甜品"), "side");
  assert.equal(categoryOf("辅助用品"), "main");
});

test("categoryOf 用商品名压过带偏的分类名", () => {
  // 人气热卖是跨分类营销位，里面的薯饼/炸鸡必须按商品名判
  assert.equal(categoryOf("人气热卖", "蘸酱炸鸡"), "side");
  assert.equal(categoryOf("人气热卖", "蓝莓爆爆珠麦旋风"), "side");
  // 小食拼盘/多人餐是分享餐，不能因「小食」落进小食位
  assert.equal(categoryOf("小食拼盘\n/多人餐", "BFF四宫格小食盘"), "main");
  assert.equal(categoryOf("小食拼盘\n/多人餐", "薄皮V翅双拼十翅"), "main");
  // 含小食词但是正餐；含套餐词但是饮品
  assert.equal(categoryOf("炸鸡", "麦辣鸡翅4块套餐"), "main");
  assert.equal(categoryOf("饮品", "学生专享饮品随心选"), "drink");
  // 分类名含换行也要能判定
  assert.equal(categoryOf("小食甜品\n/其他", "圆筒冰淇淋"), "side");
  assert.equal(categoryOf("巨无霸\n牛鱼肉堡", "双层吉士汉堡"), "main");
});

test("normalizeMenu 剔除周边与非餐品", () => {
  const payload = {
    data: {
      categories: [{ name: "小食甜品\n/其他", meals: [{ code: "a" }, { code: "b" }, { code: "c" }, { code: "d" }] }],
      meals: {
        a: { name: "麦当劳限定丝巾", currentPrice: 34.9 },
        b: { name: "薯条脆卜卜毛绒周边", currentPrice: 24.9 },
        c: { name: "如意百宝袋", currentPrice: 12 },
        d: { name: "薯条", currentPrice: 14 },
      },
    },
  };
  assert.deepEqual(
    normalizeMenu(payload).map((i) => i.name),
    ["薯条"],
  );
});

test("annotateAvailability 标出目标商品本店未在售的券", () => {
  const coupons = annotateAvailability(
    [
      { id: "1", productCodes: ["p1"] },
      { id: "2", productCodes: ["gone"] },
      { id: "3", productCodes: [] },
    ],
    [{ id: "p1" }],
  );
  assert.equal(coupons[0].targetOnSale, true);
  assert.equal(coupons[1].targetOnSale, false);
  assert.equal(coupons[2].targetOnSale, null);
});

test("pickStore 城市查询走按地点搜索（searchType=2）", async () => {
  const calls = [];
  const stub = {
    callTool: async (name, args) => {
      calls.push(args);
      return { content: [{ type: "text", text: '{"success":true,"data":[{"storeCode":"BJ1","storeName":"北京前门店"}]}' }] };
    },
  };
  const { store, source } = await pickStore(stub, "北京市");
  assert.equal(store.storeCode, "BJ1");
  assert.equal(source, "location");
  assert.equal(calls[0].searchType, 2);
  assert.equal(calls[0].keyword, "北京市");
});

test("pickStore 关键词优先于城市名", async () => {
  const calls = [];
  const stub = {
    callTool: async (name, args) => {
      calls.push(args);
      return { content: [{ type: "text", text: '{"success":true,"data":[{"storeCode":"S1"}]}' }] };
    },
  };
  await pickStore(stub, "北京市", "国贸");
  assert.equal(calls[0].keyword, "国贸");
});

test("pickStore 城市搜不到时退回收藏门店并标记来源", async () => {
  const stub = {
    callTool: async (name, args) => {
      const hit = args.searchType === 1 ? '{"success":true,"data":[{"storeCode":"FAV1"}]}' : '{"success":true,"data":[]}';
      return { content: [{ type: "text", text: hit }] };
    },
  };
  const { store, source } = await pickStore(stub, "不存在的城市");
  assert.equal(store.storeCode, "FAV1");
  assert.equal(source, "favorite");
});

test("pickStore 全部查询失败时抛出明确错误", async () => {
  const stub = { callTool: async () => ({ content: [{ type: "text", text: '{"success":false,"data":[]}' }] }) };
  await assert.rejects(() => pickStore(stub, "北京市"), /没有查到可点餐门店/);
});

test("oracleCombo 用券商品替换同分类商品", () => {
  const menu = [
    { id: "m1", name: "麦香鸡", price: 15, category: "main" },
    { id: "bigmac", name: "巨无霸", price: 24, category: "main" },
    { id: "s1", name: "小薯", price: 7, category: "side" },
    { id: "d1", name: "纯水", price: 4, category: "drink" },
  ];
  const combo = [
    { id: "m1", name: "麦香鸡", price: 15, category: "main" },
    { id: "s1", name: "小薯", price: 7, category: "side" },
    { id: "d1", name: "纯水", price: 4, category: "drink" },
  ];
  const next = oracleCombo(combo, { productCodes: ["bigmac"] }, menu);
  assert.deepEqual(next.map((i) => i.id), ["bigmac", "s1", "d1"]);
});

test("oracleCombo 组合缺少该分类时追加", () => {
  const menu = [
    { id: "m1", name: "麦香鸡", price: 15, category: "main" },
    { id: "bigmac", name: "巨无霸", price: 24, category: "main" },
    { id: "s1", name: "小薯", price: 7, category: "side" },
  ];
  const next = oracleCombo([{ id: "m1", name: "麦香鸡", price: 15, category: "main" }], { productCodes: ["s1"] }, menu);
  assert.deepEqual(next.map((i) => i.id), ["m1", "s1"]);
});

test("oracleCombo 适用商品不在售时返回 null", () => {
  const menu = [{ id: "m1", name: "麦香鸡", price: 15, category: "main" }];
  assert.equal(oracleCombo([], { productCodes: ["nope"] }, menu), null);
});

test("probePrice 解析成功响应（分换算为元）", async () => {
  const stub = {
    callTool: async () => ({ content: [{ type: "text", text: '## Original Response\n{"success":true,"data":{"price":2690,"discount":500}}' }] }),
  };
  const r = await probePrice(stub, {}, [{ id: "x", price: 26.9 }], null);
  assert.equal(r.price, 26.9);
  assert.equal(r.discount, 5);
});

test("probePrice 业务失败时返回 null", async () => {
  const stub = {
    callTool: async () => ({ content: [{ type: "text", text: '{"success":false,"code":600012,"message":"促销规则不支持该商品"}' }] }),
  };
  assert.equal(await probePrice(stub, {}, [{ id: "x", price: 26.9 }], { id: "c", code: "cc", productCodes: ["x"] }), null);
});

test("probePrice 调用异常时返回 null", async () => {
  const stub = { callTool: async () => { throw new Error("network"); } };
  assert.equal(await probePrice(stub, {}, [], null), null);
});

test("probePrice 把券挂到适用商品上", async () => {
  let captured;
  const stub = {
    callTool: async (name, args) => {
      captured = args;
      return { content: [{ type: "text", text: '{"success":true,"data":{"price":100,"discount":0}}' }] };
    },
  };
  await probePrice(stub, { storeCode: "1", beType: 1, orderType: 1 }, [{ id: "a", price: 10 }, { id: "b", price: 20 }], {
    id: "cid",
    code: "ccode",
    productCodes: ["b"],
  });
  assert.deepEqual(captured.items, [
    { productCode: "a", quantity: 1 },
    { productCode: "b", quantity: 1, couponId: "cid", couponCode: "ccode" },
  ]);
});

const nutritionText = [
  "[3]{productName,nutritionDescription,energyKj,energyKcal,protein,fat,carbohydrate,sodium,calcium}:",
  "  中薯条,null,1210,289,4,12,38,165,18",
  "  可乐中杯,null,616,147,0,0,37,55,11",
  "  板烧鸡腿堡,null,1636,391,23,17,34,806,120",
].join("\n");

test("parseNutrition 解析官方营养表", () => {
  const table = parseNutrition({ data: nutritionText });
  assert.equal(table.size, 3);
  assert.equal(table.get("中薯条"), 289);
  assert.equal(table.get("板烧鸡腿堡"), 391);
});

test("attachCalories 只按商品名精确匹配，套餐不被硬套单品热量", () => {
  const table = parseNutrition({ data: nutritionText });
  const items = attachCalories(
    [
      { id: "a", name: "板烧鸡腿堡", price: 24, category: "main" },
      { id: "b", name: "板烧鸡腿堡三件套", price: 35, category: "main" },
    ],
    table,
  );
  assert.equal(items[0].kcal, 391);
  assert.equal(items[1].kcal, undefined, "套餐不能继承单品热量");
});

test("parseComposition 把套餐子项热量累加", () => {
  const table = parseNutrition({ data: nutritionText });
  const payload = {
    data: {
      code: "9900016073",
      name: "板烧鸡腿堡三件套",
      rounds: [
        { id: 1, name: "选择汉堡", choices: [{ code: "1", name: "板烧鸡腿堡", quantity: 1, isDefault: 1 }] },
        {
          id: 2,
          name: "选择套餐内小食",
          choices: [
            { code: "2", name: "中薯条", quantity: 1, isDefault: 1 },
            { code: "3", name: "大薯条", quantity: 0, isDefault: 0 },
          ],
        },
        { id: 3, name: "选择饮品", choices: [{ code: "4", name: "可乐中杯", quantity: 1, isDefault: 1 }] },
      ],
    },
  };
  const composition = parseComposition(payload, table);
  assert.equal(composition.kcal, 827); // 391 + 289 + 147
  assert.deepEqual(composition.parts.map((part) => part.name), ["板烧鸡腿堡", "中薯条", "可乐中杯"]);
});

test("parseComposition 有子项查不到时整单记未知，不做部分累加", () => {
  const table = parseNutrition({ data: nutritionText });
  const payload = {
    data: {
      rounds: [
        { id: 1, name: "选择汉堡", choices: [{ name: "板烧鸡腿堡", quantity: 1, isDefault: 1 }] },
        { id: 2, name: "选择饮品", choices: [{ name: "某款没收录的饮料", quantity: 1, isDefault: 1 }] },
      ],
    },
  };
  const composition = parseComposition(payload, table);
  assert.equal(composition.kcal, null);
  assert.deepEqual(composition.unknown, ["某款没收录的饮料"]);
});

test("parseComposition 没有默认项时退回第一个有数量的候选", () => {
  const table = parseNutrition({ data: nutritionText });
  const payload = {
    data: { rounds: [{ id: 1, name: "蓝区", choices: [{ name: "空", quantity: 0 }, { name: "板烧鸡腿堡", quantity: 1 }] }] },
  };
  assert.equal(parseComposition(payload, table).kcal, 391);
});

test("enrichCalories 只查缺热量的商品，并把套餐热量补上", async () => {
  const table = parseNutrition({ data: nutritionText });
  const calls = [];
  const stub = {
    callTool: async (name, args) => {
      calls.push(args.code);
      const body = {
        success: true,
        data: { rounds: [{ id: 1, name: "选择汉堡", choices: [{ name: "板烧鸡腿堡", quantity: 1, isDefault: 1 }] }] },
      };
      return { content: [{ type: "text", text: JSON.stringify(body) }] };
    },
  };
  const items = [
    { id: "known", name: "中薯条", price: 11, category: "side", kcal: 289 },
    { id: "bundle", name: "板烧鸡腿堡三件套", price: 35, category: "main" },
  ];
  const result = await enrichCalories(stub, {}, items, table, { ids: ["bundle", "known"] });
  assert.deepEqual(calls, ["bundle"], "已知热量的商品不应再查详情");
  assert.equal(result.resolved, 1);
  assert.equal(result.items.find((item) => item.id === "bundle").kcal, 391);
});

test("enrichCalories 请求失败时静默降级为未知", async () => {
  const table = parseNutrition({ data: nutritionText });
  const stub = { callTool: async () => { throw new Error("boom"); } };
  const items = [{ id: "bundle", name: "板烧鸡腿堡三件套", price: 35, category: "main" }];
  const result = await enrichCalories(stub, {}, items, table, { ids: ["bundle"] });
  assert.equal(result.resolved, 0);
  assert.equal(result.items[0].kcal, undefined);
});

test("没有营养表时不发任何详情请求", async () => {
  let called = 0;
  const stub = { callTool: async () => { called++; return { content: [] }; } };
  const items = [{ id: "bundle", name: "板烧鸡腿堡三件套", price: 35, category: "main" }];
  const result = await enrichCalories(stub, {}, items, new Map(), { ids: ["bundle"] });
  assert.equal(called, 0);
  assert.equal(result.calls, 0);
});

test("filterAvoid 按关键词剔除，剔空时明确报错", () => {
  const items = [
    { id: "a", name: "麦辣鸡腿堡", price: 23, category: "main" },
    { id: "b", name: "巨无霸", price: 26, category: "main" },
  ];
  assert.deepEqual(filterAvoid(items, ["辣"]).map((item) => item.id), ["b"]);
  assert.deepEqual(filterAvoid(items, "辣,脆").map((item) => item.id), ["b"]);
  assert.equal(filterAvoid(items, []).length, 2);
  assert.throws(() => filterAvoid(items, ["堡", "巨无霸"]), /全部餐品都过滤掉了/);
});
