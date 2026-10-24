import { copyFile, mkdir } from "node:fs/promises";

// 把纯计算核心同步到 docs/core/，供 GitHub Pages 直接以 ESM 加载。
// 单一事实来源仍是 src/core/combo-core.mjs；test/demo.test.mjs 会断言两份文件一致，
// 防止有人只改了 src 忘了同步（或反之）。
const from = new URL("../src/core/combo-core.mjs", import.meta.url);
const toDir = new URL("../docs/core/", import.meta.url);

await mkdir(toDir, { recursive: true });
await copyFile(from, new URL("combo-core.mjs", toDir));
console.log("已同步 src/core/combo-core.mjs -> docs/core/combo-core.mjs");
