import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Model } from "@opencode/core/model"
import { ModelsDev } from "@opencode/core/models-dev"
import { Provider } from "@opencode/core/provider"
import { it } from "./lib/effect"

test("normalizes permissive interleaved values to compatibility", () => {
  expect(Model.compatibility("reasoning_text")).toEqual({ reasoningField: "reasoning_text" })
  expect(Model.compatibility({ field: "vendor_reasoning" })).toEqual({ reasoningField: "vendor_reasoning" })
  expect(Model.compatibility(true)).toBeUndefined()
  expect(Model.compatibility(false)).toBeUndefined()
})

const fixture = {
  modelscope: {
    id: "modelscope",
    name: "ModelScope",
    env: ["MODELSCOPE_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    models: {
      "modelscope-1": {
        id: "modelscope-1",
        name: "ModelScope One",
        release_date: "2026-01-01",
        attachment: false,
        reasoning: false,
        temperature: true,
        tool_call: true,
        interleaved: { field: "vendor_reasoning" },
        limit: { context: 128000, output: 8192 },
      },
    },
  },
}

const buildLayer = (options?: ModelsDev.Options) =>
  // Layer.fresh is required because the ModelsDev implementation is a module-level Layer constant,
  // and Effect.provide uses a process-global MemoMap by default — without fresh,
  // every test would reuse the cached state from the first run.
  Layer.fresh(AppNodeBuilder.build(ModelsDev.node, [ModelsDev.node.replace(ModelsDev.configured(options))]))

describe("ModelsDev Service", () => {
  it.live("maps models.dev npm packages onto native packages", () =>
    Effect.gen(function* () {
      // Stock catalogs are filtered to domestic providers, so this mapping test loads its
      // catalog through the explicit-file path, which is not filtered.
      const catalog = {
        modelscope: {
          ...fixture.modelscope,
          models: {
            "modelscope-1": {
              ...fixture.modelscope.models["modelscope-1"],
              provider: { npm: "@ai-sdk/openai" },
            },
          },
        },
        "cloudflare-workers-ai": {
          id: "cloudflare-workers-ai",
          name: "Cloudflare Workers AI",
          env: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_KEY"],
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1",
          models: {},
        },
        azure: {
          id: "azure",
          name: "Azure",
          env: ["AZURE_RESOURCE_NAME", "AZURE_API_KEY"],
          npm: "@ai-sdk/azure",
          models: {
            "gpt-5": {
              ...fixture.modelscope.models["modelscope-1"],
              id: "gpt-5",
            },
            "custom-chat": {
              ...fixture.modelscope.models["modelscope-1"],
              id: "custom-chat",
              provider: { shape: "completions" },
            },
          },
        },
      }
      const directory = yield* Effect.sync(() => mkdtempSync(join(tmpdir(), "opencode-models-dev-")))
      yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(directory, { recursive: true, force: true })))
      const file = join(directory, "catalog.json")
      yield* Effect.sync(() => writeFileSync(file, JSON.stringify(catalog)))
      const result = yield* ModelsDev.Service.use((service) => service.get()).pipe(
        Effect.provide(buildLayer({ file })),
      )
      expect(result[0]?.info.package).toBe("@opencode/ai/providers/openai-compatible")
      expect(result[0]?.models[0]?.package).toBe("@opencode/ai/providers/openai")
      expect(result[1]?.info.package).toBe("@opencode/ai/providers/cloudflare-workers-ai")
      expect(result[1]?.info.settings).toBeUndefined()
      expect(result[2]?.info.package).toBe("@opencode/ai/providers/azure/responses")
      expect(result[2]?.models.find((model) => model.id === "gpt-5")?.package).toBeUndefined()
      expect(result[2]?.models.find((model) => model.id === "custom-chat")?.package).toBe(
        "@opencode/ai/providers/azure/chat",
      )
    }),
  )

  it.live("get() returns an empty catalog when the bundled snapshot is disabled", () =>
    Effect.gen(function* () {
      const result = yield* ModelsDev.Service.use((s) => s.get()).pipe(Effect.provide(buildLayer({ snapshot: false })))
      expect(result).toEqual([])
    }),
  )

  it.live("get() falls back to the bundled snapshot", () =>
    Effect.gen(function* () {
      const result = yield* ModelsDev.Service.use((s) => s.get()).pipe(Effect.provide(buildLayer()))
      expect(result.length).toBeGreaterThan(0)
      const deepseek = result.find((snapshot) => snapshot.info.id === "deepseek")
      expect(deepseek?.environment).toContain("DEEPSEEK_API_KEY")
    }),
  )

  it.live("get() filters the bundled snapshot down to domestic providers", () =>
    Effect.gen(function* () {
      const result = yield* ModelsDev.Service.use((s) => s.get()).pipe(Effect.provide(buildLayer()))
      const ids = result.map((snapshot) => snapshot.info.id)
      expect(ids).toContain(Provider.ID.make("deepseek"))
      for (const foreign of ["openai", "anthropic", "google", "amazon-bedrock"]) expect(ids).not.toContain(foreign)
    }),
  )

  it.live("get() caches across calls (later file changes are ignored)", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.sync(() => mkdtempSync(join(tmpdir(), "opencode-models-dev-")))
      yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(directory, { recursive: true, force: true })))
      const file = join(directory, "catalog.json")
      yield* Effect.sync(() => writeFileSync(file, JSON.stringify(fixture)))
      const results = yield* ModelsDev.Service.use((svc) =>
        Effect.gen(function* () {
          const first = yield* svc.get()
          yield* Effect.sync(() => writeFileSync(file, JSON.stringify({})))
          const second = yield* svc.get()
          return { first, second }
        }),
      ).pipe(Effect.provide(buildLayer({ file })))
      expect(results.second).toEqual(results.first)
      expect(results.second[0]?.info.name).toBe("ModelScope")
    }),
  )
})
