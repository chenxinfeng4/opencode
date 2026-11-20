#!/usr/bin/env bun
// Provider check webserver.
//
// Boots the modified opencode server from source, then serves a dashboard that
// lists the providers and models the server exposes:
//   http://localhost:<port>/            dashboard
//   http://localhost:<port>/api/summary combined provider/model summary JSON
//   http://localhost:<port>/api/provider  raw opencode provider.list response
//   http://localhost:<port>/api/model     raw opencode model.list response
//
// Usage: bun run script/provider-webserver.ts [--port 4100] [--server-port 4096]

const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const DASHBOARD_PORT = Number(arg("port") ?? 4100)
const SERVER_PORT = Number(arg("server-port") ?? 4096)
const SERVER_HOSTNAME = arg("hostname") ?? "0.0.0.0"
// Proxy and health checks stay on loopback even when the server binds a wildcard address.
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`
const REPO_ROOT = new URL("..", import.meta.url).pathname

interface ProviderInfo {
  id: string
  name: string
  package?: string
  activation?: string
  settings?: Record<string, unknown>
}
interface ModelInfo {
  id: string
  providerID: string
  name: string
  status?: string
}
interface IntegrationInfo {
  id: string
  name: string
  connections?: readonly unknown[]
}

// Mirror of the domestic allowlist in packages/core/src/models-dev.ts; anything
// the server exposes beyond this set can only come from user configuration.
const DOMESTIC_PROVIDER_IDS = new Set([
  "alibaba",
  "alibaba-cn",
  "alibaba-coding-plan",
  "alibaba-coding-plan-cn",
  "alibaba-token-plan",
  "alibaba-token-plan-cn",
  "modelscope",
  "deepseek",
  "moonshotai",
  "moonshotai-cn",
  "kimi-code-plan-cn",
  "kimi-code-plan-global",
  "zai",
  "zai-coding-plan",
  "zhipuai",
  "zhipuai-coding-plan",
  "minimax",
  "minimax-cn",
  "minimax-coding-plan",
  "minimax-cn-coding-plan",
  "volcengine",
  "volcengine-coding-plan",
  "tencent-coding-plan",
  "tencent-token-plan",
  "tencent-tokenhub",
  "stepfun",
  "stepfun-ai",
  "stepfun-ai-step-plan",
  "stepfun-step-plan",
  "sensenova",
  "siliconflow",
  "siliconflow-cn",
  "xiaomi",
  "xiaomi-token-plan-ams",
  "xiaomi-token-plan-cn",
  "xiaomi-token-plan-sgp",
  "longcat",
  "iflowcn",
  "302ai",
  "aihubmix",
  "agentrouter",
  "bailing",
  "drun",
  "jiekou",
  "kuae-cloud-coding-plan",
  "qihang-ai",
  "qiniu-ai",
  "scnet-token-plan",
])

// Web-search integrations are not model providers.
const SEARCH_INTEGRATION_IDS = new Set(["exa", "firecrawl", "parallel", "tavily", "tinyfish"])

// Reuses OPENCODE_SERVER_PASSWORD from the environment when set (e.g. sourced from ~/.bashrc);
// otherwise generates a throwaway password for this run.
const SERVER_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD || crypto.randomUUID()
const serverHeaders = { Authorization: `Basic ${btoa(`opencode:${SERVER_PASSWORD}`)}` }

// API responses wrap payloads as { location, data }; unwrap to the payload.
async function opencode(path: string): Promise<unknown> {
  const response = await fetch(`${SERVER_URL}${path}`, { headers: serverHeaders })
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`)
  const body = (await response.json()) as { data?: unknown }
  return body.data ?? body
}

function origin(id: string) {
  if (DOMESTIC_PROVIDER_IDS.has(id)) return "domestic"
  if (SEARCH_INTEGRATION_IDS.has(id)) return "websearch"
  return "custom"
}

async function startOpencodeServer() {
  const child = Bun.spawn({
    cmd: [
      "bun",
      "run",
      "--cwd",
      "packages/cli",
      "src/index.ts",
      "serve",
      "--hostname",
      SERVER_HOSTNAME,
      "--port",
      String(SERVER_PORT),
    ],
    cwd: REPO_ROOT,
    env: { ...process.env, OPENCODE_SERVER_PASSWORD: SERVER_PASSWORD },
    stdout: "inherit",
    stderr: "inherit",
  })
  process.on("exit", () => child.kill())
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const ready = await fetch(`${SERVER_URL}/api/provider`, { headers: serverHeaders })
      .then((response) => response.ok)
      .catch(() => false)
    if (ready) break
    if (child.exitCode !== null) throw new Error(`opencode server exited with code ${child.exitCode}`)
    await Bun.sleep(500)
  }
  if (child.exitCode !== null) throw new Error(`opencode server exited with code ${child.exitCode}`)
  // Wait for the provider plugins to settle so the dashboard shows the full catalog.
  const settled = Date.now() + 60_000
  while (Date.now() < settled) {
    const integrations = (await opencode("/api/integration").catch(() => undefined)) as IntegrationInfo[] | undefined
    if (Array.isArray(integrations) && integrations.length > 0) return
    if (child.exitCode !== null) throw new Error(`opencode server exited with code ${child.exitCode}`)
    await Bun.sleep(1000)
  }
}

function escapeHTML(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

function providerCard(provider: ProviderInfo, models: ModelInfo[], kind: string) {
  const badge = `<span class="badge ${kind}">${kind === "domestic" ? "国内" : "自定义"}</span>`
  const rows = models
    .map(
      (model) =>
        `<tr><td>${escapeHTML(model.id)}</td><td>${escapeHTML(model.name)}</td><td>${escapeHTML(model.status ?? "active")}</td></tr>`,
    )
    .join("")
  return `<details class="provider" data-id="${escapeHTML(provider.id)}" data-kind="${kind}">
    <summary><code>${escapeHTML(provider.id)}</code> ${escapeHTML(provider.name)} ${badge} <span class="count">${models.length} models</span></summary>
    <table><thead><tr><th>model id</th><th>name</th><th>status</th></tr></thead><tbody>${rows}</tbody></table>
  </details>`
}

function integrationCard(integration: IntegrationInfo) {
  const kind = origin(integration.id)
  const badge = `<span class="badge ${kind}">${{ domestic: "国内内置", websearch: "搜索", custom: "自定义" }[kind]}</span>`
  const connected = (integration.connections?.length ?? 0) > 0
  return `<div class="integration" data-id="${escapeHTML(integration.id)}" data-kind="${kind}">
    <code>${escapeHTML(integration.id)}</code> ${escapeHTML(integration.name)} ${badge}
    <span class="count">${connected ? "已连接" : "未连接（待填 API key）"}</span>
  </div>`
}

function renderDashboard(providers: ProviderInfo[], models: ModelInfo[], integrations: IntegrationInfo[]) {
  const byProvider = new Map<string, ModelInfo[]>()
  for (const model of models) {
    const list = byProvider.get(model.providerID) ?? []
    list.push(model)
    byProvider.set(model.providerID, list)
  }
  const cards = providers
    .map((provider) => providerCard(provider, byProvider.get(provider.id) ?? [], origin(provider.id)))
    .join("\n")
  const catalogProviders = new Set(providers.map((provider) => provider.id))
  const pending = integrations
    .filter((integration) => !catalogProviders.has(integration.id) && origin(integration.id) !== "websearch")
    .sort((left, right) => origin(left.id).localeCompare(origin(right.id)) || left.id.localeCompare(right.id))
  const pendingCards = pending.map(integrationCard).join("\n")
  const domestic = providers.filter((provider) => origin(provider.id) === "domestic").length
  const custom = providers.filter((provider) => origin(provider.id) === "custom").length
  const pendingDomestic = pending.filter((integration) => origin(integration.id) === "domestic").length
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>opencode provider 检查</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; background: #0d1117; color: #e6edf3; margin: 0; padding: 2rem; }
  h1 { font-size: 1.4rem; } h1 code { color: #7ee787; }
  h2 { font-size: 1.1rem; margin-top: 2rem; }
  .stats { display: flex; gap: 1rem; margin: 1rem 0; flex-wrap: wrap; }
  .stat { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: .75rem 1.25rem; }
  .stat b { font-size: 1.5rem; display: block; }
  input { background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-radius: 6px; padding: .5rem .75rem; width: 320px; }
  details.provider, .integration { background: #161b22; border: 1px solid #30363d; border-radius: 8px; margin: .5rem 0; padding: .5rem .75rem; }
  details.provider[data-kind="custom"] { border-color: #d29922; }
  summary { cursor: pointer; display: flex; align-items: center; gap: .5rem; }
  .count { color: #8b949e; font-size: .85rem; }
  .badge { font-size: .75rem; border-radius: 999px; padding: .1rem .5rem; }
  .badge.domestic { background: #0f3520; color: #7ee787; border: 1px solid #2ea043; }
  .badge.custom { background: #3d2e00; color: #e3b341; border: 1px solid #d29922; }
  .badge.websearch { background: #0a2a4a; color: #79c0ff; border: 1px solid #1f6feb; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; font-size: .85rem; }
  th, td { text-align: left; padding: .25rem .5rem; border-bottom: 1px solid #21262d; }
  th { color: #8b949e; }
  .hidden { display: none; }
  code { color: #79c0ff; }
  a { color: #58a6ff; }
</style>
</head>
<body>
<h1>opencode provider 检查 <code>@ ${escapeHTML(SERVER_URL)}</code></h1>
<div class="stats">
  <div class="stat"><b>${providers.length}</b>已启用 providers</div>
  <div class="stat"><b>${domestic}</b>国内 provider</div>
  <div class="stat"><b>${custom}</b>自定义 provider</div>
  <div class="stat"><b>${pendingDomestic}</b>国内待连接</div>
  <div class="stat"><b>${models.length}</b>可用 models</div>
</div>
<p><input id="search" placeholder="过滤 provider id / 名称…" oninput="filter()"></p>
<h2>已启用 providers（含模型）</h2>
<section id="list">
${cards}
</section>
<h2>内置 catalog providers（待连接，来源 models.dev 白名单）</h2>
<section id="pending">
${pendingCards}
</section>
<p>原始数据: <a href="/api/provider">/api/provider</a> · <a href="/api/model">/api/model</a> · <a href="/api/integration">/api/integration</a> · <a href="/api/summary">/api/summary</a></p>
<script>
function filter() {
  const query = document.getElementById("search").value.toLowerCase()
  for (const item of document.querySelectorAll("details.provider, .integration")) {
    item.classList.toggle("hidden", !item.dataset.id.toLowerCase().includes(query) && !item.textContent.toLowerCase().includes(query))
  }
}
</script>
</body>
</html>`
}

function summary(providers: ProviderInfo[], models: ModelInfo[], integrations: IntegrationInfo[]) {
  return {
    server: SERVER_URL,
    totals: {
      providers: providers.length,
      models: models.length,
      domesticProviders: providers.filter((provider) => origin(provider.id) === "domestic").length,
      customProviders: providers.filter((provider) => origin(provider.id) === "custom").length,
      integrations: integrations.length,
      domesticPending: integrations.filter((integration) => origin(integration.id) === "domestic").length,
    },
    providers: providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      origin: origin(provider.id),
      models: models.filter((model) => model.providerID === provider.id).map((model) => model.id),
    })),
    integrations: integrations.map((integration) => ({
      id: integration.id,
      name: integration.name,
      origin: origin(integration.id),
      connected: (integration.connections?.length ?? 0) > 0,
    })),
  }
}

await startOpencodeServer()
console.log(`opencode server ready at ${SERVER_URL}`)

Bun.serve({
  port: DASHBOARD_PORT,
  async fetch(request) {
    const url = new URL(request.url)
    const target = `${url.pathname}${url.search}`
    if (["/api/provider", "/api/model", "/api/integration"].includes(url.pathname))
      return new Response(JSON.stringify(await opencode(target)), { headers: { "Content-Type": "application/json" } })
    if (url.pathname === "/api/summary") {
      const [providers, models, integrations] = (await Promise.all([
        opencode(`/api/provider${url.search}`),
        opencode(`/api/model${url.search}`),
        opencode(`/api/integration${url.search}`),
      ])) as [ProviderInfo[], ModelInfo[], IntegrationInfo[]]
      return new Response(JSON.stringify(summary(providers, models, integrations)), {
        headers: { "Content-Type": "application/json" },
      })
    }
    if (url.pathname === "/") {
      const [providers, models, integrations] = (await Promise.all([
        opencode(`/api/provider${url.search}`),
        opencode(`/api/model${url.search}`),
        opencode(`/api/integration${url.search}`),
      ])) as [ProviderInfo[], ModelInfo[], IntegrationInfo[]]
      return new Response(renderDashboard(providers, models, integrations), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    }
    return new Response("Not found", { status: 404 })
  },
})

console.log(
  `provider 检查页面: http://localhost:${DASHBOARD_PORT}/  (server: ${SERVER_HOSTNAME}:${SERVER_PORT}, Basic auth 用户名 opencode / 密码 ${SERVER_PASSWORD})`,
)
