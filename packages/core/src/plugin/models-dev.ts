import { define } from "@opencode/plugin/effect/plugin"
import { Integration } from "@opencode/schema/integration"
import { Provider } from "@opencode/schema/provider"
import { Effect } from "effect"
import { Model } from "../model.js"
import { ModelsDev } from "../models-dev.js"

// These catalog entries require inference profiles on Bedrock Runtime.
// Opus/Sonnet 4.6 support in-region calls in eu-west-2 and must remain available.
const BEDROCK_PROFILE_ONLY_IDS = [
  "amazon.nova-2-lite-v1:0",
  "anthropic.claude-fable-5",
  "anthropic.claude-fable-5-1",
  "anthropic.claude-haiku-4-5-20251001-v1:0",
  "anthropic.claude-opus-4-1-20250805-v1:0",
  "anthropic.claude-opus-4-5-20251101-v1:0",
  "anthropic.claude-opus-4-7",
  "anthropic.claude-opus-4-8",
  "anthropic.claude-opus-5",
  "anthropic.claude-sonnet-4-5-20250929-v1:0",
  "anthropic.claude-sonnet-5",
  "deepseek.r1-v1:0",
  "mistral.pixtral-large-2502-v1:0",
]

export const ModelsDevPlugin = define({
  id: "opencode.models.dev",
  effect: Effect.fn(function* (ctx) {
    const modelsDev = yield* ModelsDev.Service
    // The catalog is static (bundled snapshot or an explicit file), so the
    // plugin registers its providers once.
    const data = snapshots(yield* modelsDev.get())
    yield* ctx.integration.transform((integrations) => {
      for (const provider of data) {
        if (provider.environment.length === 0) continue
        const integrationID = provider.info.id
        integrations.update(integrationID, (integration) => (integration.name = provider.info.name))
        integrations.method.update({
          integrationID,
          method: { type: "key" },
        })
        integrations.method.update({
          integrationID,
          method: {
            type: "env",
            // Every listed variable is treated as a key; plugins override providers that also list setup values.
            names: [...provider.environment],
          },
        })
      }
    })
    yield* ctx.provider.transform((providers) => {
      for (const provider of data) {
        providers.add({
          info: { ...provider.info, integrationID: Integration.ID.make(provider.info.id) },
          models: provider.models,
        })
      }
    })
  }),
})

// Provider records share catalog definitions across Locations. The WeakMap keeps one
// filtered copy per snapshot instance so sibling Locations reference the same objects.
const prepared = new WeakMap<readonly ModelsDev.Snapshot[], readonly ModelsDev.Snapshot[]>()

function snapshots(data: readonly ModelsDev.Snapshot[]) {
  const cached = prepared.get(data)
  if (cached) return cached
  const result = data
    .filter(
      // These deprecated aliases are replaced by the canonical Azure and Google Vertex providers.
      (provider) => provider.info.id !== "azure-cognitive-services" && provider.info.id !== "google-vertex-anthropic",
    )
    .map((provider) => ({
      ...provider,
      models: provider.models.filter(
        (model) =>
          model.status !== "deprecated" &&
          Model.supportsText(model) &&
          !(
            provider.info.id === Provider.ID.amazonBedrock &&
            BEDROCK_PROFILE_ONLY_IDS.includes(model.modelID ?? model.id)
          ),
      ),
    }))
  prepared.set(data, result)
  return result
}
