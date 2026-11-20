import { useDialog } from "@opencode/ui/context/dialog"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import type { JSX } from "solid-js"
import { ExtensionContext, useExtension, type IpcClient } from "../../../../gui-extensions/src/sdk"
import type { Pairing } from "../../../../gui-extensions/src/pairing/contract"
import type { PairingServer } from "../../../../gui-extensions/src/pairing/page"
// The pairing page renders inside the app's settings page, which brings these styles.
import "@/settings/settings.css"

/**
 * A local server whose info lists a reachable address unless `reachable` is false, as when it listens on loopback
 * only, and the pairing main entry.
 */
export function pairing(input: { reachable?: boolean }) {
  const server: PairingServer = {
    client: {
      server: {
        info: async () => ({
          urls: ["http://127.0.0.1:49374", ...(input.reachable === false ? [] : ["http://192.168.10.248:49374"])],
        }),
        pair: async () => ({ code: pairingCode(), expires_in: 300 }),
      },
    },
  }
  const client: IpcClient<typeof Pairing.spec> = {
    screenActive: async () => false,
    setScreenActive: async () => undefined,
    state: () => undefined,
    on: () => () => undefined,
  }

  return { server, client }
}

/**
 * Stands in for the HostApis the pairing page reads that extension stories do not provide: dialogs through the app's
 * dialog stack, and a clipboard that accepts every copy.
 */
export function PairingHost(props: { children: JSX.Element }) {
  const base = useExtension()
  const dialog = useDialog()
  const client = new QueryClient()
  // Dialogs render in the app's dialog stack, outside this subtree, so they get the context again as the host does.
  const scoped = (render: () => JSX.Element) => (
    <QueryClientProvider client={client}>
      <ExtensionContext.Provider value={context}>{render()}</ExtensionContext.Provider>
    </QueryClientProvider>
  )
  const context = Object.create(base, {
    dialogs: {
      value: {
        open: (render: () => JSX.Element) => {
          void dialog.show(() => scoped(render))
          return { close: () => dialog.close() }
        },
      },
    },
    system: { value: { copy: async () => undefined } },
  })

  return scoped(() => (
    <div class="settings-screen" style={{ "max-width": "820px", padding: "32px", margin: "0 auto" }}>
      {props.children}
    </div>
  ))
}

// The server's codes are 16 random bytes in base64url.
function pairingCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}
