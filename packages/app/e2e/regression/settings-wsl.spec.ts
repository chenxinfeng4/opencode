import { base64Encode } from "@opencode/util/encode"
import { expect, test } from "@playwright/test"
import { NO_PROVIDER, REMOTE_SERVER, SERVER, project, session } from "../utils/app"
import { mockOpenCodeServer, mockServers } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

test.use({ viewport: { width: 1280, height: 900 } })

for (const mode of ["failed", "stopped", "ready"] as const) {
  test(`manages a ${mode} configured WSL server from nested settings`, async ({ page }) => {
    await mockOpenCodeServer(page, {
      directory: "/repo",
      project: project({ id: "proj_wsl_settings", directory: "/repo", name: "WSL project" }),
      provider: NO_PROVIDER,
      sessions: [],
      pageMessages: () => ({ items: [] }),
    })
    await page.goto(`/e2e/utils/settings-wsl.html?${new URLSearchParams({ server: SERVER, mode })}`)
    const settings = page.getByTestId("settings-screen")
    await expect(settings.getByRole("tab", { name: "Local Server", exact: true })).toBeEnabled()
    const ubuntu = settings.getByRole("tab", { name: "Ubuntu", exact: true })
    await expect(ubuntu).toHaveCount(1)
    await ubuntu.click()
    await expect(settings.getByRole("heading", { name: "Ubuntu", exact: true })).toBeVisible()
    const connection = settings.locator('[data-component="settings-server-connection"]')

    if (mode !== "ready") {
      await expect(settings.getByRole("tab", { name: "Projects", exact: true })).toBeDisabled()
      await connection.getByRole("button", { name: "More options", exact: true }).click()
      await page.getByRole("menuitem", { name: "Retry start", exact: true }).click()
      await expect(page.getByLabel("WSL actions")).toHaveText("start:wsl:Ubuntu")
    }

    await expect(settings.getByRole("tab", { name: "Projects", exact: true })).toBeEnabled()
    await connection.getByRole("button", { name: "Update OpenCode", exact: true }).click()
    await expect(page.getByLabel("WSL actions")).toContainText("update:Ubuntu")
    await expect(connection.getByRole("button", { name: "Update OpenCode", exact: true })).toHaveCount(0)

    await connection.getByRole("button", { name: "More options", exact: true }).click()
    await page.getByRole("menuitem", { name: "Remove", exact: true }).click()
    await expect(page.getByLabel("WSL actions")).toContainText("remove:wsl:Ubuntu")
    await expect(settings.getByRole("tab", { name: "Ubuntu", exact: true })).toHaveCount(0)
    await expect(settings.getByRole("tab", { name: "Server", exact: true })).toBeEnabled()
  })
}

test("adding a WSL server while the WSL extension is down shows that WSL is unavailable", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory: "/repo",
    project: project({ id: "proj_wsl_unavailable", directory: "/repo", name: "WSL project" }),
    provider: NO_PROVIDER,
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.goto(`/e2e/utils/settings-wsl.html?${new URLSearchParams({ server: SERVER, mode: "ready" })}`)
  const settings = page.getByTestId("settings-screen")
  await expect(settings.getByRole("tab", { name: "Ubuntu", exact: true })).toHaveCount(1)
  await page.getByRole("checkbox", { name: "WSL extension" }).uncheck()

  await settings.getByRole("button", { name: "Add server", exact: true }).press("Enter")
  await page.getByRole("menuitem", { name: "Add WSL server", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: "WSL unavailable", exact: true })).toBeVisible()
  await expect(dialog.getByText("OpenCode could not verify WSL on this machine.", { exact: true })).toBeVisible()
  await expect(dialog.getByText("WSL is unavailable", { exact: true })).toBeVisible()
})

test("an open session's terminal follows its WSL server to the endpoint it restarts on", async ({ page }) => {
  const restarted = "http://127.0.0.1:4098"
  const directory = "/home/ubuntu/project"
  const wsl = session({ id: "ses_wsl", directory, title: "WSL session" })

  const config = {
    directory,
    project: project({ id: "proj_wsl", directory }),
    provider: NO_PROVIDER,
    sessions: [wsl],
    pageMessages: () => ({ items: [] }),
  }

  const servers = await mockServers(page, {
    [SERVER]: { ...config, sessions: [] },
    [REMOTE_SERVER]: { ...config, pty: { prefix: "pty_before" } },
    [restarted]: { ...config, pty: { prefix: "pty_after" } },
  })

  const path = `/server/${base64Encode("wsl:Ubuntu")}/session/${wsl.id}`
  await page.goto(
    `/e2e/utils/settings-wsl.html?${new URLSearchParams({ server: SERVER, mode: "ready", wsl: REMOTE_SERVER, restart: restarted, path })}`,
  )
  await expectSessionTitle(page, wsl.title)
  await page.keyboard.press("Control+Backquote")
  await expect.poll(() => servers[REMOTE_SERVER]!.pty.sockets.map((socket) => socket.id)).toEqual(["pty_before1"])

  await page.keyboard.press("Control+,")
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Ubuntu", exact: true }).click()
  const connection = settings.locator('[data-component="settings-server-connection"]')
  await connection.getByRole("button", { name: "Update OpenCode", exact: true }).click()
  await expect(connection.getByRole("button", { name: "Update OpenCode", exact: true })).toHaveCount(0)
  await settings.getByRole("button", { name: "Back to settings" }).click()
  await settings.getByRole("button", { name: "Back to app" }).click()
  await expectSessionTitle(page, wsl.title)

  // The tab and its open terminal outlive the restart. The stopped server no longer knows the terminal, so it is
  // recreated on the restarted one.
  await expect.poll(() => servers[restarted]!.pty.sockets.map((socket) => socket.id)).toEqual(["pty_after1"])
  expect(servers[REMOTE_SERVER]!.pty.sockets.map((socket) => socket.id)).toEqual(["pty_before1"])
})

test("WSL session and draft tabs outlive the extension going away until the server is removed", async ({ page }) => {
  const directory = "/home/ubuntu/project"
  const wsl = session({ id: "ses_wsl_tabs", directory, title: "WSL tabs session" })

  const config = {
    directory,
    project: project({ id: "proj_wsl_tabs", directory }),
    provider: NO_PROVIDER,
    sessions: [wsl],
    pageMessages: () => ({ items: [] }),
  }

  await mockServers(page, { [SERVER]: { ...config, sessions: [] }, [REMOTE_SERVER]: config })
  const href = `/server/${base64Encode("wsl:Ubuntu")}/session/${wsl.id}`
  await page.goto(
    `/e2e/utils/settings-wsl.html?${new URLSearchParams({ server: SERVER, mode: "ready", wsl: REMOTE_SERVER, path: href })}`,
  )
  await expectSessionTitle(page, wsl.title)
  await page.getByRole("button", { name: "New session", exact: true }).click()
  await expect(page.getByRole("heading", { name: wsl.title })).toHaveCount(0)
  const editor = page.locator('[data-component="composer-editor"]')
  await editor.fill("keep this draft")
  await expect(editor).toHaveText("keep this draft")
  const tabs = page.locator("a[data-titlebar-tab-link]")

  const expectTabs = async () => {
    await expect(tabs).toHaveCount(2)
    await expect(tabs.nth(0)).toHaveAttribute("href", href)
    await expect(tabs.nth(1)).toHaveAttribute("href", /^\/new-session\?draftId=/)
  }

  await expectTabs()

  const extension = page.getByRole("checkbox", { name: "WSL extension" })
  await extension.uncheck()
  await expectTabs()
  await expect(editor).toHaveText("keep this draft")
  await extension.check()
  await expectTabs()
  await tabs.nth(0).click()
  await expectSessionTitle(page, wsl.title)

  await page.keyboard.press("Control+,")
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Ubuntu", exact: true }).click()
  const connection = settings.locator('[data-component="settings-server-connection"]')
  await connection.getByRole("button", { name: "More options", exact: true }).click()
  await page.getByRole("menuitem", { name: "Remove", exact: true }).click()
  await expect(page.getByLabel("WSL actions")).toHaveText("remove:wsl:Ubuntu")
  await expect(tabs).toHaveCount(0)
})
