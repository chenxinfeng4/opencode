import { PairingHost, pairing } from "../../../storybook/.storybook/mocks/gui-extensions/pairing"
import PairingPage from "./page"

const story = (reachable: boolean, main = true) => ({
  render: () => {
    const mock = pairing({ reachable })

    return (
      <PairingHost>
        <PairingPage
          server={() => mock.server}
          pairing={() =>
            main ? { status: "active", value: mock.client, generation: 1 } : { status: "inactive", reason: "disabled" }
          }
        />
      </PairingHost>
    )
  },
})

export default {
  title: "Extensions/Pairing",
  id: "extensions-pairing",
  parameters: {
    docs: {
      description: {
        component: "Settings → Pairing on desktop: pair a device on the same network, and its QR code.",
      },
    },
  },
}

/** The server has a reachable address, so Pair device shows the QR code at once. */
export const Reachable = story(true)

/** The server listens on loopback only, so the dialog explains how to make the server reachable. */
export const OnlyLoopback = story(false)

/** Pairing's main side is not running, so the display setting is missing. */
export const WithoutMainProcess = story(true, false)
