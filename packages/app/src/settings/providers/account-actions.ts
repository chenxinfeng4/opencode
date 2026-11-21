import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { type ProviderAccount } from "./accounts"

// Provider accounts are not stored in this build; providers authenticate from opencode.json.
export function useProviderAccountActions(directory: () => string | undefined) {
  const language = useLanguage()
  const data = useData()

  const refresh = async () => {
    const value = directory()
    const ref = value ? { directory: value } : undefined
    data.location.integration.invalidate(ref)
    data.location.provider.invalidate(ref)
    data.location.model.invalidate(ref)
    await Promise.all([
      data.location.integration.sync(ref),
      data.location.provider.sync(ref),
      data.location.model.sync(ref),
    ])
  }

  const unavailable = async (_input: {
    integrationID: string
    provider: string
    account: ProviderAccount
    final?: boolean
  }) => {
    void language
    await refresh()
  }

  const activate = unavailable
  const remove = unavailable
  const rename = async (_account: ProviderAccount, _label: string) => {
    await refresh()

    return false
  }

  return { refresh, activate, remove, rename }
}
