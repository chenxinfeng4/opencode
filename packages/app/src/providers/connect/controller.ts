import type { FormAnswer, IntegrationInfo, IntegrationMethod } from "@opencode/client/promise"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"

export type ProviderConnectMethod = Extract<IntegrationMethod, { type: "key" }>

export function providerFormDefaults(fields: ProviderConnectMethod["form"]) {
  return (fields ?? []).reduce<FormAnswer>((answer, field) => {
    if (field.type === "external" || !field.hidden || field.default === undefined) return answer

    const active = (field.when ?? []).every((condition) => {
      const actual = answer[condition.key]

      if (actual === undefined) return false

      const equal = Array.isArray(actual)
        ? actual.some((item) => item === condition.value)
        : actual === condition.value

      return condition.op === "eq" ? equal : !equal
    })

    if (!active) return answer

    return Object.assign(answer, { [field.key]: field.default })
  }, {})
}

export function createProviderConnectionController(options: {
  provider: () => string
  /** Integration that stores API keys when it differs from the one that lists methods. */
  keyProvider?: () => string
  directory: () => string | undefined
  onComplete: () => void
  /** Skips auto-selecting a lone method; the caller starts it. */
  manual?: () => boolean
}) {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const data = useData()

  const location = () => {
    const directory = options.directory()

    return directory ? { directory } : undefined
  }

  // Not createResource: the dialog is owned by whichever page opened it, so reading a pending
  // resource here would suspend that page's <Suspense> and blank the screen behind the dialog.
  const [integration, setIntegration] = createStore<{ loading: boolean; latest?: IntegrationInfo }>({
    loading: true,
  })

  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  createEffect(
    on(
      () => ({ provider: options.provider(), directory: options.directory() }),
      (input) => {
        setIntegration({ loading: true, latest: undefined })
        serverSDK.api.integration
          .get({ integrationID: input.provider, location: location() })
          .then((result) => result.data)
          .catch(() => undefined)
          .then((latest) => {
            if (disposed) return

            if (input.provider !== options.provider() || input.directory !== options.directory()) return
            setIntegration({ loading: false, latest })
          })
      },
    ),
  )

  // API keys only: OAuth and external browser-based methods are intentionally not offered.
  const methods = createMemo<ProviderConnectMethod[]>(() => {
    const values = integration.latest?.methods.filter((method): method is ProviderConnectMethod => method.type === "key")

    if (values?.length) return [...values]

    return [{ type: "key", label: language.t("provider.connect.method.apiKey") }]
  })

  const [store, setStore] = createStore<{
    methodIndex?: number
    formAnswer?: FormAnswer
    state?: "form" | "refreshing" | "ready" | "error"
    error?: string
    auto: boolean
    connected: boolean
  }>({
    auto: false,
    // The credential is stored; a retry only needs to reload the catalogs.
    connected: false,
  })

  const currentMethod = createMemo(() =>
    store.methodIndex === undefined ? undefined : methods().at(store.methodIndex),
  )

  const autoIndex = createMemo(() => {
    if (integration.loading || options.manual?.()) return undefined

    return methods().length === 1 ? 0 : undefined
  })

  type Action =
    | { type: "method.select"; index: number }
    | { type: "method.reset" }
    | { type: "auth.form" }
    | { type: "auth.answer"; answer: FormAnswer | undefined }
    | { type: "auth.error"; error: string }

  const dispatch = (action: Action) => {
    setStore(
      produce((draft) => {
        if (action.type === "method.select" || action.type === "method.reset") {
          draft.methodIndex = action.type === "method.select" ? action.index : undefined
          draft.formAnswer = undefined
          draft.state = undefined
          draft.error = undefined
          draft.connected = false

          return
        }

        if (action.type === "auth.form") {
          draft.state = "form"
          draft.error = undefined

          return
        }

        if (action.type === "auth.answer") {
          draft.formAnswer = action.answer
          draft.state = undefined
          draft.error = undefined

          return
        }

        draft.state = "error"
        draft.error = action.error
      }),
    )
  }

  const finish = async () => {
    setStore({ connected: true, state: "refreshing", error: undefined })
    const ref = location()
    data.location.integration.invalidate(ref)
    data.location.provider.invalidate(ref)
    data.location.model.invalidate(ref)

    const refreshed = await Promise.all([
      data.location.integration.sync(ref),
      data.location.provider.sync(ref),
      data.location.model.sync(ref),
    ])
      .then(() => true)
      .catch(() => false)

    if (!refreshed) return

    setStore("state", "ready")
    options.onComplete()
  }

  const select = (index: number, answer?: FormAnswer) => {
    const selected = methods()[index]
    dispatch({ type: "method.select", index })
    const visible = (selected.form ?? []).some((field) => field.type === "external" || !field.hidden)

    if (visible && !answer) {
      dispatch({ type: "auth.form" })

      return
    }

    const merged = { ...providerFormDefaults(selected.form), ...answer }
    dispatch({ type: "auth.answer", answer: Object.keys(merged).length ? merged : undefined })
  }

  const retry = () => {
    if (store.connected) return finish()
    const index = store.methodIndex

    if (index === undefined) return

    return select(index, store.formAnswer)
  }

  const reset = () => {
    dispatch({ type: "method.reset" })
  }

  const connectKey = async (key: string) => {
    await serverSDK.api.integration.connect.key({
      integrationID: options.keyProvider?.() ?? options.provider(),
      location: location(),
      key,
      answer: store.formAnswer,
    })
    await finish()
  }

  createEffect(() => {
    const index = autoIndex()

    if (store.auto || index === undefined) return
    setStore("auto", true)
    select(index)
  })

  return {
    loading: () => integration.loading,
    integration: () => integration.latest,
    methods,
    currentMethod,
    methodIndex: () => store.methodIndex,
    // True while nothing useful can be shown yet: the integration is loading, or a method is
    // about to be picked automatically.
    busy: () => integration.loading || (store.methodIndex === undefined && !store.auto && autoIndex() !== undefined),
    auth: {
      state: () => store.state,
      error: () => store.error,
      select,
      reset,
      retry,
      refresh: finish,
      connectKey,
    },
  }
}

export type ProviderConnectionController = ReturnType<typeof createProviderConnectionController>
