import { DynamicProviderPlugin } from "./provider/dynamic.js"
import { PromptCacheKeyPlugin } from "./provider/prompt-cache-key.js"
import type { PluginInternal } from "./internal.js"

// Catalog providers are trimmed to the domestic allowlist in models-dev.ts, so only the
// cross-provider behavior plugins remain here. DynamicProviderPlugin loads the npm package
// behind user-configured custom providers.
export const ProviderPlugins: PluginInternal.InternalPlugin[] = [PromptCacheKeyPlugin, DynamicProviderPlugin]
