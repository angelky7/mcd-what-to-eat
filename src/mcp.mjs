#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const DEFAULT_URL = "https://mcp.mcd.cn";
const PROTOCOL_VERSION = "2025-03-26";

export class McdMcpClient {
  #url;
  #token;
  #sessionId = null;
  #nextId = 1;

  constructor({ url = process.env.MCD_MCP_URL || DEFAULT_URL, token = process.env.MCD_MCP_TOKEN } = {}) {
    if (!token) throw new Error("缺少 MCD_MCP_TOKEN，请先到 https://open.mcd.cn/mcp 申请开发者 Token 并写入 .env");
    this.#url = url;
    this.#token = token;
  }

  async #post(payload) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.#token}`,
    };
    if (this.#sessionId) headers["Mcp-Session-Id"] = this.#sessionId;
    headers["MCP-Protocol-Version"] = PROTOCOL_VERSION;

    const res = await fetch(this.#url, { method: "POST", headers, body: JSON.stringify(payload) });
    if (res.status === 202) return null;
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);

    const sid = res.headers.get("mcp-session-id");
    if (sid) this.#sessionId = sid;

    const text = await res.text();
    return parseBody(text, res.headers.get("content-type") || "");
  }

  async #rpc(method, params = {}) {
    const id = this.#nextId++;
    const body = await this.#post({ jsonrpc: "2.0", id, method, params });
    if (!body) throw new Error(`MCP ${method} 返回空响应`);
    if (body.error) throw new Error(`MCP ${method} 失败: ${body.error.message ?? JSON.stringify(body.error)}`);
    return body.result;
  }

  async initialize() {
    const result = await this.#rpc("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "mcd-what-to-eat", version: "1.0.0" },
    });
    await this.#post({ jsonrpc: "2.0", method: "notifications/initialized" });
    return result;
  }

  async listTools() {
    const tools = [];
    let cursor;
    do {
      const page = await this.#rpc("tools/list", cursor ? { cursor } : {});
      tools.push(...(page.tools ?? []));
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name, args = {}) {
    const result = await this.#rpc("tools/call", { name, arguments: args });
    if (result.isError) throw new Error(`工具 ${name} 调用失败: ${textOf(result)}`);
    return result;
  }
}

function parseBody(text, contentType) {
  if (contentType.includes("text/event-stream")) {
    const messages = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
      .map((json) => JSON.parse(json));
    return messages.find((m) => m.result || m.error) ?? null;
  }
  return text ? JSON.parse(text) : null;
}

export function textOf(result) {
  return (result?.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function main(argv) {
  const [command, ...rest] = argv;
  try {
    process.loadEnvFile();
  } catch {}
  const client = new McdMcpClient();
  const info = await client.initialize();

  if (command === "ping") {
    console.log(`已连接 ${info.serverInfo?.name ?? "McDonald's MCP"} ${info.serverInfo?.version ?? ""}`.trim());
    return;
  }
  if (command === "list") {
    const tools = await client.listTools();
    for (const tool of tools) {
      console.log(`\n${tool.name}`);
      if (tool.description) console.log(`  ${tool.description.replace(/\s+/g, " ").slice(0, 200)}`);
      const schema = tool.inputSchema ?? {};
      const props = Object.entries(schema.properties ?? {});
      if (props.length) console.log(`  参数: ${props.map(([k, v]) => `${k}${schema.required?.includes(k) ? "*" : ""}(${v.type ?? "?"})`).join(", ")}`);
    }
    console.log(`\n共 ${tools.length} 个工具`);
    return;
  }
  if (command === "call") {
    const [name, rawArgs] = rest;
    if (!name) throw new Error("用法: node src/mcp.mjs call <tool> '<json>'");
    const result = await client.callTool(name, rawArgs ? JSON.parse(rawArgs) : {});
    console.log(textOf(result) || JSON.stringify(result, null, 2));
    return;
  }
  throw new Error("用法: node src/mcp.mjs ping|list|call <tool> '<json>'");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
