import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Spinner } from "@opencode/ui/spinner"
import { Switch } from "@opencode/ui/switch"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createMemo, createSignal, onCleanup, Show, type Accessor, type JSX } from "solid-js"
import { renderSVG } from "uqr"
import { useExtension, type Live, type IpcClient } from "../sdk"
import { reachableAddresses } from "./addresses"
import type { Pairing } from "./contract"
import type definition from "./index"

type Client = IpcClient<typeof Pairing.spec>

/**
 * The parts of the local server's `ServerRef` the page uses. The renderer passes the live ref, so `client` is read
 * on every call and follows a restarted server.
 */
export type PairingServer = {
  readonly client: {
    readonly server: {
      info(options: { signal: AbortSignal }): Promise<{ readonly urls: readonly string[] }>
      pair(options: { signal: AbortSignal }): Promise<{ readonly code: string; readonly expires_in: number }>
    }
  }
}

export default function PairingPage(props: {
  server: Accessor<PairingServer | undefined>
  pairing: Accessor<Live<Client>>
}) {
  const ctx = useExtension<typeof definition>()
  // The extension's dialogs close with it, so disabling pairing also stops the dialog's code polling.
  const dialogs = ctx.dialogs
  const queryClient = useQueryClient()

  // The display setting needs pairing's main side; pairing codes come from the server, so they never wait.
  const main = () => {
    const live = props.pairing()

    return live.status === "active" ? live : undefined
  }

  const addresses = async (signal: AbortSignal) => {
    const server = props.server()

    if (!server) throw new Error("The local server is not listed")
    const found = reachableAddresses((await server.client.server.info({ signal })).urls)

    if (found.length === 0) throw new Error("The server has no address another device can reach")

    return found
  }

  const code = async (signal: AbortSignal) => {
    const server = props.server()

    if (!server) throw new Error("The local server is not listed")
    const pairing = await server.client.server.pair({ signal })

    return { code: pairing.code, expiresIn: pairing.expires_in }
  }

  const pair = () => {
    dialogs.open(() => <DialogPairing addresses={addresses} code={code} />)
  }

  const screenActive = useQuery(() => ({
    queryKey: [ctx.id, "screen-active", main()?.generation],
    queryFn: (input) => {
      const live = main()

      if (!live) throw new Error("Pairing's main side is not active")

      return live.value.screenActive({ signal: input.signal })
    },
    enabled: !!main(),
    gcTime: 0,
  }))

  const screenActivity = useMutation(() => ({
    mutationFn: (enabled: boolean) => {
      const live = main()

      if (!live) throw new Error("Pairing's main side is not active")

      return live.value.setScreenActive(enabled)
    },
    onSuccess: (_, enabled) => queryClient.setQueryData([ctx.id, "screen-active", main()?.generation], enabled),
  }))

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{ctx.t("title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{ctx.t("description")}</span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body settings-tab-body--sectioned">
        <section class="settings-section" aria-label={ctx.t("title")}>
          <div data-component="settings-list">
            <Row title={ctx.t("pair.title")} description={ctx.t("pair.description")}>
              <Button variant="neutral" disabled={!props.server()} onClick={pair}>
                {ctx.t("pair.open")}
              </Button>
            </Row>
            <Show when={main()}>
              <div data-action="settings-keep-screen-active">
                <Row title={ctx.t("screenActive.title")} description={ctx.t("screenActive.description")}>
                  <Switch
                    hideLabel
                    checked={screenActive.isSuccess && screenActive.data}
                    disabled={screenActive.isPending || !!screenActive.error || screenActivity.isPending}
                    onChange={(enabled) => screenActivity.mutate(enabled)}
                  >
                    {ctx.t("screenActive.title")}
                  </Switch>
                </Row>
              </div>
            </Show>
          </div>
          <Show when={main() && (screenActive.error || screenActivity.error)}>
            <p class="text-text-danger-base" role="alert">
              {ctx.t("screenActive.error")}
            </p>
          </Show>
          {/* Pending main is still starting; anything else that leaves it inactive keeps pairing from turning on. */}
          <Show when={props.pairing().status === "inactive" || !props.server()}>
            <p class="text-text-danger-base" role="alert">
              {ctx.t("pair.unavailable")}
            </p>
          </Show>
        </section>
      </div>
    </>
  )
}

/** The pending return from "Copied" to the copy label. */
type CopiedTimer = { timeout?: ReturnType<typeof setTimeout> }

function DialogPairing(props: {
  addresses: (signal: AbortSignal) => Promise<readonly string[]>
  code: (signal: AbortSignal) => Promise<{ readonly code: string; readonly expiresIn: number }>
}) {
  const ctx = useExtension()
  const system = ctx.system

  // The server listens on loopback only until its hostname changes, so the retry button asks again.
  const address = useQuery(() => ({
    queryKey: [ctx.id, "address"],
    queryFn: (input) => props.addresses(input.signal),
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  }))

  // Codes are single-use, so replace the link as soon as the server forgets the current code.
  const code = useQuery(() => ({
    queryKey: [ctx.id, "code", address.data],
    queryFn: (input) => props.code(input.signal),
    enabled: address.isSuccess,
    gcTime: 0,
    refetchInterval: (query) => (query.state.data?.expiresIn ?? 60) * 1000,
    // A minimized window must not come back to a code that expired while it was hidden.
    refetchIntervalInBackground: true,
  }))

  // The countdown is the only clock on the page.
  const [now, setNow] = createSignal(Date.now())
  const clock = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(clock))

  const remaining = () => {
    if (!code.isSuccess) return 0

    // The clock can lag a fresh code by up to a second; a negative age would show one second too many.
    return Math.max(0, code.data.expiresIn - Math.floor(Math.max(0, now() - code.dataUpdatedAt) / 1000))
  }

  const url = createMemo(() => {
    if (!code.isSuccess || !address.isSuccess) return

    return new URL(`/auth/connect/${code.data.code}`, address.data[0]).href
  })

  const failed = () => address.isError

  // "Copied" shows for two seconds after each copy.
  const copied: CopiedTimer = {}
  onCleanup(() => clearTimeout(copied.timeout))

  const copy = useMutation(() => ({
    mutationFn: async () => {
      const value = url()

      if (!value) return
      await system.copy(value)
    },
    onMutate: () => clearTimeout(copied.timeout),
    onSuccess: () => {
      copied.timeout = setTimeout(() => copy.reset(), 2000)
    },
  }))

  const refresh = () => (
    <button
      type="button"
      class="rounded-[4px] px-1 text-12-regular leading-[var(--line-height-compact)] text-v2-text-text-muted underline-offset-2 hover:text-v2-text-text-base hover:underline focus-visible:underline focus-visible:outline-none disabled:opacity-50"
      disabled={code.isFetching}
      onClick={() => {
        clearTimeout(copied.timeout)
        copy.reset()
        void code.refetch()
      }}
    >
      {ctx.t("refresh")}
    </button>
  )

  // The QR code carries the reachable addresses as `opencode pair` prints them, {"code","urls"} JSON, which the
  // app's scanner reads.
  const qr = createMemo(() => {
    if (!code.isSuccess || !address.isSuccess) return

    return renderSVG(JSON.stringify({ code: code.data.code, urls: address.data }), {
      border: 4,
      blackColor: "currentColor",
      whiteColor: "transparent",
    })
  })

  // The QR code's frame, which also holds the setup progress and its failure, so the dialog keeps its size.
  const frame = "mx-auto aspect-square w-full max-w-[min(320px,calc(100dvh-360px))] shrink-0 rounded-[6px]"

  return (
    <Dialog fit containerClass="max-w-[min(400px,calc(100vw-32px))]">
      <DialogHeader>
        <DialogTitleGroup title={ctx.t("pair.title")} description={ctx.t("dialog.description")} />
      </DialogHeader>
      <DialogBody class="flex flex-col gap-4 px-4 pb-4">
        <Show when={url()}>
          <div
            class={`${frame} bg-v2-background-bg-base p-6 text-v2-text-text-base [&>svg]:size-full`}
            role="img"
            aria-label={ctx.t("qr")}
            innerHTML={qr()}
          />
          <div class="flex flex-col items-center gap-1 pb-2">
            <Button
              variant="neutral"
              icon={copy.isSuccess ? "check" : "copy"}
              disabled={copy.isPending}
              onClick={() => copy.mutate()}
            >
              {ctx.t(copy.isSuccess ? "common.copied" : "copyLink")}
            </Button>
            <div class="flex items-center gap-2 text-12-regular leading-[var(--line-height-compact)] text-v2-text-text-muted">
              <span role="timer" aria-live="off">
                {ctx.t("expires", { time: countdown(remaining()) })}
              </span>
              <span aria-hidden="true">·</span>
              {refresh()}
            </div>
          </div>
        </Show>
        <Show when={!url() && !failed() && !code.error}>
          <div
            class={`${frame} flex flex-col items-center justify-center gap-2 bg-v2-background-bg-layer-01 p-6 text-center`}
            role="status"
          >
            <Spinner class="size-5 text-v2-icon-icon-muted" />
            <span class="text-[13px] font-[530] leading-[var(--line-height-compact)] text-v2-text-text-base">
              {ctx.t("setup.pending")}
            </span>
          </div>
        </Show>
        <Show when={failed()}>
          <div
            class={`${frame} flex flex-col items-center justify-center gap-3 bg-v2-background-bg-layer-01 p-6 text-center`}
          >
            <p class="text-text-danger-base" role="alert">
              {ctx.t("setup.error")}
            </p>
            <span class="text-12-regular leading-[var(--line-height-compact)] text-v2-text-text-muted">
              {ctx.t("setup.hint")}
            </span>
            <Button variant="neutral" onClick={() => void address.refetch()}>
              {ctx.t("retry")}
            </Button>
          </div>
        </Show>
        {/* A failed code fetch hides the link, so the way to try again stays next to the error. */}
        <Show when={!url() && !failed() && code.error}>
          <div class="flex flex-col items-center gap-1">
            <p class="text-text-danger-base" role="alert">
              {ctx.t("error")}
            </p>
            {refresh()}
          </div>
        </Show>
        <Show when={copy.error}>
          <p class="text-text-danger-base" role="alert">
            {ctx.t("copy.error")}
          </p>
        </Show>
      </DialogBody>
    </Dialog>
  )
}

function countdown(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

// The host's settings row markup; its stylesheet is loaded with the settings screen.
function Row(props: { title: string; description: string; children: JSX.Element }) {
  return (
    <div data-component="settings-row">
      <div data-slot="settings-row-copy">
        <div data-slot="settings-row-title">{props.title}</div>
        <div data-slot="settings-row-description">{props.description}</div>
      </div>
      <div data-slot="settings-row-control">{props.children}</div>
    </div>
  )
}
