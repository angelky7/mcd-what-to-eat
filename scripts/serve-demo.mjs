// 极简静态服务：本地预览 docs/（GitHub Pages 用的是同样的静态托管方式）
// 用法：node scripts/serve-demo.mjs [端口]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../docs/", import.meta.url));
const port = Number(process.argv[2]) || 8080;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = decodeURIComponent(url.pathname) === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = join(root, normalize(pathname).replace(/^(\.\.[/\\])+/, ""));
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("404");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Demo: http://127.0.0.1:${port}/  （Ctrl+C 停止）`);
});
