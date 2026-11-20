import { ModelsDev } from "@opencode/core/models-dev"

// The catalog is the bundled snapshot; no network access happens at boot or
// later. Real-Location fixtures still replace the node explicitly so the test
// graph reads the same way after future catalog sources.
export const offlineModels = ModelsDev.node.replace(ModelsDev.configured())
