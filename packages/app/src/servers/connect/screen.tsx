import { lazy, Show, Suspense } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@opencode/ui/button"
import { TextInput } from "@opencode/ui/text-input"
import { Wordmark } from "@opencode/ui/wordmark"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useCheckServerHealth } from "@/runtime/server/health"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { serverAddress, type Pairing } from "./pairing"
import { useRedeemPairing } from "./redeem"
import { isMixedContent } from "./browser"
import { cameraHint, createCameraAvailability } from "./camera"
import "./screen.css"

const PairingScanner = lazy(() => import("./scanner").then((module) => ({ default: module.PairingScanner })))

export function ConnectServerScreen(props: { url?: string } = {}) {
  const language = useLanguage()
  const platform = usePlatform()
  const servers = useServers()
  const check = useCheckServerHealth()
  const redeem = useRedeemPairing()
  const camera = createCameraAvailability()

  const [state, setState] = createStore<{
    pairing: boolean
    link: string
    url: string
    password: string
    error: string
    scanning: boolean
  }>({
    pairing: false,
    link: "",
    url: props.url ?? "",
    password: "",
    error: "",
    scanning: false,
  })

  // A pairing token works on every address of its server. Signing in again to the server that signed out keeps its
  // address (e.g. localhost) even when the link names another one (e.g. 127.0.0.1 from opencode pair).
  const target = async (pairing: Pairing) => {
    if (!props.url || props.url === pairing.url) return pairing
    const http = { url: props.url, password: pairing.password }

    return (await check(http)).healthy ? http : pairing
  }

  const connect = async (http: ServerConnection.HttpBase) => {
    const result = await check(http)

    if (!result.healthy) {
      setState("error", connectionError(http.url))

      return
    }

    // Signing in again keeps the name the user gave this server.
    const existing = servers.list.find(
      (server): server is ServerConnection.Http => server.type === "http" && server.http.url === http.url,
    )

    servers.add(existing ? { ...existing, http } : { type: "http", http })
  }

  const connectionError = (url: string) =>
    language.t(
      platform.platform === "web" && isMixedContent(location.href, url)
        ? "server.connect.mixedContent"
        : "server.connect.failed",
    )

  const request = useMutation(() => ({
    mutationFn: async (intent: "password" | "pairing") => {
      if (intent === "pairing") {
        const redeemed = await redeem(state.link)

        if (redeemed && "error" in redeemed) return void setState("error", redeemed.error)

        if (redeemed) return connect(await target(redeemed.pairing))

        return void setState("error", language.t("server.connect.link.invalid"))
      }

      // The page is served by the server it signs into, so the address is known and only the password is asked.
      const url = props.url ? serverAddress(props.url) : serverAddress(state.url)

      if (!url) return void setState("error", language.t("server.connect.address.invalid"))

      await connect({ url, password: state.password || undefined })
    },
    onError: (_error, intent) => setState("error", connectionError(intent === "pairing" ? state.link : state.url)),
  }))

  const submit = (intent: "password" | "pairing") => {
    if (request.isPending) return
    setState("error", "")
    request.mutate(intent)
  }

  return (
    <main data-component="connect-server" aria-labelledby="server-connect-title">
      <div class="server-connect-content">
        <div class="server-connect-brand" role="img" aria-label="OpenCode">
          <Wordmark />
        </div>
        <header>
          <h1 id="server-connect-title">{language.t("server.connect.title")}</h1>
          <p>
            {language.t(
              state.pairing
                ? "server.connect.description.pairing"
                : props.url
                  ? "server.connect.description.self"
                  : "server.connect.description",
            )}
          </p>
        </header>
        <Show
          when={!state.scanning}
          fallback={
            <Suspense fallback={<p role="status">{language.t("server.connect.camera.starting")}</p>}>
              <PairingScanner
                redeem={redeem}
                onCancel={() => {
                  setState("scanning", false)
                  void camera.refetch()
                }}
                onScan={(link) => {
                  setState({ pairing: true, link, error: "", scanning: false })
                  submit("pairing")
                }}
              />
            </Suspense>
          }
        >
          <Show when={state.error}>
            <p id="server-connect-error" class="server-connect-error" role="alert">
              {state.error}
            </p>
          </Show>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              submit("password")
            }}
          >
            <Show
              when={props.url}
              fallback={
                <div class="server-connect-field">
                  <label for="server-connect-url">{language.t("dialog.server.add.url")}</label>
                  <TextInput
                    id="server-connect-url"
                    name="server"
                    dir="ltr"
                    type="text"
                    inputMode="url"
                    autocomplete="url"
                    autocapitalize="off"
                    spellcheck={false}
                    required
                    appearance="large"
                    placeholder={language.t("dialog.server.add.placeholder")}
                    value={state.url}
                    disabled={request.isPending}
                    aria-describedby={state.error ? "server-connect-error" : undefined}
                    onInput={(event) => setState({ url: event.currentTarget.value, error: "" })}
                  />
                </div>
              }
            >
              <div class="server-connect-field">
                <label for="server-connect-password">{language.t("dialog.server.add.password")}</label>
                <TextInput
                  id="server-connect-password"
                  name="password"
                  type="password"
                  autocomplete="current-password"
                  appearance="large"
                  value={state.password}
                  disabled={request.isPending}
                  aria-describedby="server-connect-password-hint"
                  onInput={(event) => setState({ password: event.currentTarget.value, error: "" })}
                />
                <p id="server-connect-password-hint" class="server-connect-hint">
                  {language.t("server.connect.password.hint")}
                </p>
              </div>
            </Show>
            <Button
              type="submit"
              variant="contrast"
              size="large"
              disabled={request.isPending || (!props.url && !state.url.trim())}
            >
              {language.t(request.isPending ? "dialog.server.add.checking" : "server.connect.button")}
            </Button>
          </form>
          <div class="server-connect-pairing">
            <button
              type="button"
              class="server-connect-pairing-toggle"
              aria-expanded={state.pairing}
              onClick={() => setState({ pairing: !state.pairing, error: "" })}
            >
              <svg class="server-connect-pairing-chevron" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M6 4l4 4-4 4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              {language.t("server.connect.pair.toggle")}
            </button>
            <Show when={state.pairing}>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  submit("pairing")
                }}
              >
                <div class="server-connect-field">
                  <label for="server-connect-link">{language.t("server.connect.link")}</label>
                  <TextInput
                    id="server-connect-link"
                    name="link"
                    dir="ltr"
                    type="text"
                    inputMode="url"
                    autocapitalize="off"
                    spellcheck={false}
                    appearance="large"
                    placeholder={language.t("server.connect.link.placeholder")}
                    value={state.link}
                    disabled={request.isPending}
                    aria-describedby={state.error ? "server-connect-error" : undefined}
                    onInput={(event) => setState({ link: event.currentTarget.value, error: "" })}
                  />
                </div>
                <Button type="submit" variant="contrast" size="large" disabled={request.isPending || !state.link.trim()}>
                  {language.t(request.isPending ? "dialog.server.add.checking" : "server.connect.button")}
                </Button>
                <Show when={platform.platform === "web"}>
                  <Show
                    when={camera.available.latest || camera.available.loading}
                    fallback={<p>{language.t(cameraHint())}</p>}
                  >
                    <Button
                      type="button"
                      variant="neutral"
                      size="large"
                      disabled={request.isPending || !camera.available.latest}
                      onClick={() => setState("scanning", true)}
                    >
                      {language.t("server.connect.scan")}
                    </Button>
                  </Show>
                </Show>
                <footer>
                  <p>{language.t("server.connect.pair.link")}</p>
                  <code dir="ltr">opencode pair</code>
                </footer>
              </form>
            </Show>
          </div>
        </Show>
      </div>
    </main>
  )
}
