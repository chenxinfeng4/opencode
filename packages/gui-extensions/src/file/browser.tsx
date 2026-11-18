import { createMemo, createSignal, createUniqueId, onCleanup, onMount, Show, type Accessor } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { createQuery, keepPreviousData } from "@tanstack/solid-query"
import { Icon } from "@opencode/ui/icon"
import { showToast } from "@opencode/ui/toast"
import { SessionFilePanelV2, SessionFilePanelV2Empty } from "@opencode/session-ui/v2/session-file-panel-v2"
import { SessionReviewV2Sidebar } from "@opencode/session-ui/v2/session-review-v2"
import { getFilename } from "@opencode/util/path"
import type { ChangeKind } from "../review/contract"
import {
  createKeyed,
  useExtension,
  usePanel,
  type MountedSession,
  type PanelSidebar,
  type PanelTab,
  type SessionScreen,
} from "../sdk"
import { useShared } from "./context"
import SessionFileList, { applyFileListKeyDown } from "./list"
import { fileTabPath, isFileTab } from "./path"
import FileTreeV2 from "./tree-v2"
import { SessionFileView } from "./view"

const emptyFiles: string[] = []

export function SessionFileBrowserTab(props: {
  session: MountedSession
  screen: SessionScreen
  /** The file tab to show; absent while browsing. */
  id?: string
  placeholder: boolean
  active?: string
  kinds: ReadonlyMap<string, ChangeKind>
  state: PanelSidebar
  onSelect: (path: string) => void
  onSelectPermanent: (path: string) => void
  filterRef?: (element: HTMLInputElement) => void
  mobile?: boolean
}) {
  const ctx = useExtension()
  const shared = useShared()
  const file = props.screen.file
  const panel = usePanel()
  const resultsID = `session-file-browser-results-${createUniqueId()}`
  const [store, setStore] = createStore<{ explicitHighlight?: string }>({})
  const [dragging, setDragging] = createSignal(false)
  const [uploaded, setUploaded] = createSignal<string>()
  const [menu, setMenu] = createSignal<{
    x: number
    y: number
    path: string
    name: string
    absolute: string
    type: "file" | "directory"
  }>()
  const filter = () => shared.filter.get(props.session.key)
  const setFilter = (value: string) => shared.filter.set(props.session.key, value)
  const setExplicitHighlight = (value: string) => setStore("explicitHighlight", value)
  const sidebarOpened = () => true
  const query = createMemo(() => filter().trim())

  const search = createQuery(() => {
    const value = query()

    return {
      queryKey: [ctx.id, props.session.server.id, "session-open-file", file.root, value] as const,
      enabled: props.session.server.connected && value.length > 0,
      queryFn: ({ signal }) => file.search(value, { limit: 200, signal }),
      placeholderData: keepPreviousData,
    }
  })

  const files = createMemo(() => {
    if (!query() || search.isPending) return emptyFiles

    return [...new Set(search.data ?? emptyFiles)]
  })

  const highlighted = createMemo(() => {
    const values = files()

    if (values.length === 0) return undefined
    const explicit = store.explicitHighlight

    if (explicit && values.includes(explicit)) return explicit

    return values[0]
  })

  const loading = createMemo(() => query().length > 0 && search.isPending)

  const title = createMemo(() => {
    const project = props.session.listedProject ?? { worktree: file.root }

    return project.name || getFilename(project.worktree) || project.worktree
  })

  const optionID = (path: string) => `${resultsID}-option-${files().indexOf(path)}`

  const onFilterKeyDown = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (event.key === "Escape" && query()) {
      event.preventDefault()
      setFilter("")

      return
    }

    if (!query()) return
    applyFileListKeyDown(event, files(), highlighted(), {
      onHighlight: setExplicitHighlight,
      onSelect: props.onSelectPermanent,
    })
  }

  const fail = (value: unknown) => {
    showToast({
      variant: "error",
      title: ctx.t("explorer.failed"),
      description: value instanceof Error ? value.message : String(value),
    })
  }

  const download = async (path: string, name: string) => {
    try {
      const bytes = await file.read(path)
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer]))
      const anchor = document.createElement("a")

      anchor.href = url
      anchor.download = name
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (value) {
      fail(value)
    }
  }

  const rename = async (path: string, name: string) => {
    const next = window.prompt(ctx.t("explorer.newName"), name)

    if (!next || next === name) return
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""

    try {
      await file.move(path, parent ? `${parent}/${next}` : next)
    } catch (value) {
      fail(value)
    }
  }

  const copy = async (value: string) => {
    // The async clipboard API is unavailable outside a secure context, e.g. a LAN address over plain HTTP.
    if (window.isSecureContext && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(value)

        return
      } catch {
        // Fall through to the selection-based fallback.
      }
    }
    const textarea = document.createElement("textarea")

    textarea.value = value
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.top = "-9999px"
    textarea.style.opacity = "0"
    document.body.appendChild(textarea)
    textarea.select()

    const copied = document.execCommand("copy")

    textarea.remove()

    if (!copied) fail(new Error(ctx.t("explorer.copyFailed")))
  }

  const remove = async (path: string, name: string) => {
    if (!window.confirm(ctx.t("explorer.deleteConfirm", { name }))) return

    try {
      await file.remove(path)
    } catch (value) {
      fail(value)
    }
  }

  // Upload to the workspace root. Folder drops keep their relative paths.
  const upload = async (list: FileList | File[] | null | undefined) => {
    const items = Array.from(list ?? [])

    if (items.length === 0) return

    try {
      for (const item of items) {
        const relative = (item as File & { webkitRelativePath?: string }).webkitRelativePath
        const path = relative || item.name
        await file.write(path, new Uint8Array(await item.arrayBuffer()))
        const parts = path.split("/")

        for (let index = 1; index < parts.length; index++) file.tree.expand(parts.slice(0, index).join("/"))
        setUploaded(path)
      }
      await file.tree.sync("", { force: true })
    } catch (value) {
      fail(value)
    }
  }

  // Paste files onto the list. Skip text fields so normal paste keeps working.
  onMount(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!panel.visible()) return
      const target = event.target

      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, [contenteditable]"))
      )
        return
      const files = event.clipboardData?.files

      if (!files || files.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      void upload(files)
    }

    document.addEventListener("paste", onPaste, true)
    onCleanup(() => document.removeEventListener("paste", onPaste, true))
  })

  // Keep the sidebar outside Kobalte Tabs.Content: a morphing content value
  // unmounts the whole panel on every file-tab switch and resets sidebar scroll.
  return (
    <div
      class="relative h-full min-h-0 w-full"
      data-file-drop-target=""
      onDragEnter={(event) => {
        if (!event.dataTransfer?.types.includes("Files")) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer?.types.includes("Files")) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
        setDragging(false)
      }}
      onDrop={(event) => {
        if (!event.dataTransfer?.types.includes("Files")) return
        event.preventDefault()
        setDragging(false)
        void upload(event.dataTransfer.files)
      }}
    >
    <SessionFilePanelV2
      toolbar={false}
      toolbarStart={<span class="truncate font-[530]">{title()}</span>}
      sidebarCollapsed={false}
      sidebar={
        <SessionReviewV2Sidebar
          open={sidebarOpened()}
          transition={props.state.transition()}
          title={<span class="truncate font-[530]">{title()}</span>}
          filter={filter()}
          onFilterChange={setFilter}
          onFilterKeyDown={onFilterKeyDown}
          filterAutofocus={props.placeholder && !props.mobile}
          filterRef={(element) => props.filterRef?.(element)}
          filterControls={resultsID}
          filterActiveDescendant={highlighted() ? optionID(highlighted()!) : undefined}
          filterExpanded={query().length > 0 && files().length > 0}
          width={props.state.width()}
          onWidthChange={props.mobile ? undefined : props.state.resize}
        >
          <Show
            when={query()}
            fallback={
              <FileTreeV2
                session={props.session}
                screen={props.screen}
                active={uploaded() ?? props.active}
                kinds={props.kinds}
                draggable={!props.mobile}
                onFileClick={(node) => {
                  setUploaded(undefined)
                  props.onSelect(node.path)
                }}
                onFileDoubleClick={(node) => {
                  setUploaded(undefined)
                  props.onSelectPermanent(node.path)
                }}
                onNodeContextMenu={(node, event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setMenu({
                    x: event.clientX,
                    y: event.clientY,
                    path: node.path,
                    name: node.name,
                    absolute: node.absolute,
                    type: node.type,
                  })
                }}
              />
            }
          >
            <Show
              when={!loading()}
              fallback={
                <div role="status" class="px-2 py-2 text-12-regular text-text-weak">
                  {ctx.t("common.loading")}
                  {ctx.t("common.loading.ellipsis")}
                </div>
              }
            >
              <Show
                when={files().length > 0}
                fallback={
                  <div role="status" class="px-2 py-2 text-12-regular text-text-weak">
                    {ctx.t("palette.empty")}
                  </div>
                }
              >
                <SessionFileList
                  session={props.session}
                  screen={props.screen}
                  id={resultsID}
                  role="listbox"
                  optionID={optionID}
                  files={files()}
                  kinds={props.kinds}
                  active={props.active}
                  highlighted={highlighted()}
                  onFileClick={(path) => {
                    setExplicitHighlight(path)
                    props.onSelect(path)
                  }}
                  onFileDoubleClick={props.onSelectPermanent}
                />
              </Show>
            </Show>
          </Show>
        </SessionReviewV2Sidebar>
      }
    >
      <Show
        when={!props.placeholder}
        fallback={
          <SessionFilePanelV2Empty>
            <div class="flex flex-col items-center gap-2 text-center text-text-weak">
              <Icon name="file-tree" size="large" class="mb-2" />
              <div class="text-[13px] font-medium leading-[13px] text-text-strong">{ctx.t("command.open")}</div>
              <div class="h-5 text-13-regular leading-5">{ctx.t("selectToOpen")}</div>
            </div>
          </SessionFilePanelV2Empty>
        }
      >
        <div class="min-h-0 flex-1">
          <Show when={props.id} keyed>
            {(id) => <SessionFileView session={props.session} screen={props.screen} id={id} />}
          </Show>
        </div>
      </Show>
    </SessionFilePanelV2>
    <Show when={menu()}>
      {(value) => (
        <Portal>
          <div
            class="fixed inset-0 z-40"
            onClick={() => setMenu()}
            onContextMenu={(event) => {
              event.preventDefault()
              setMenu()
            }}
          />
          <div
            class="fixed z-50 w-44 rounded-md border border-border-weaker-base bg-background-stronger p-1 shadow-[var(--v2-elevation-raised)]"
            style={{
              left: `${Math.min(value().x, window.innerWidth - 184)}px`,
              top: `${Math.min(value().y, window.innerHeight - 180)}px`,
            }}
          >
            <Show when={value().type === "file"}>
              <button
                type="button"
                class="w-full rounded-sm px-2 py-1.5 text-start text-12-regular text-text-base hover:bg-surface-raised-base-hover"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const item = value()
                  setMenu()
                  void download(item.path, item.name)
                }}
              >
                {ctx.t("explorer.download")}
              </button>
            </Show>
            <button
              type="button"
              class="w-full rounded-sm px-2 py-1.5 text-start text-12-regular text-text-base hover:bg-surface-raised-base-hover"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const item = value()
                setMenu()
                void copy(item.absolute)
              }}
            >
              {ctx.t("explorer.copyPath")}
            </button>
            <button
              type="button"
              class="w-full rounded-sm px-2 py-1.5 text-start text-12-regular text-text-base hover:bg-surface-raised-base-hover"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const item = value()
                setMenu()
                void copy(item.path)
              }}
            >
              {ctx.t("explorer.copyRelativePath")}
            </button>
            <button
              type="button"
              class="w-full rounded-sm px-2 py-1.5 text-start text-12-regular text-text-base hover:bg-surface-raised-base-hover"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const item = value()
                setMenu()
                void rename(item.path, item.name)
              }}
            >
              {ctx.t("explorer.rename")}
            </button>
            <button
              type="button"
              class="w-full rounded-sm px-2 py-1.5 text-start text-12-regular text-text-base hover:bg-surface-raised-base-hover"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const item = value()
                setMenu()
                void remove(item.path, item.name)
              }}
            >
              {ctx.t("explorer.delete")}
            </button>
          </div>
        </Portal>
      )}
    </Show>
    <Show when={dragging()}>
      <div class="pointer-events-none absolute inset-0 z-[90] grid place-items-center rounded-md border-2 border-dashed border-[var(--v2-border-border-strong)] bg-[color-mix(in_srgb,var(--v2-background-bg-layer-02)_70%,transparent)]">
        <div class="flex flex-col items-center gap-2 text-v2-text-text-base">
          <Icon name="arrow-up" size="large" />
          <span class="text-13-medium">{ctx.t("explorer.dropToUpload")}</span>
        </div>
      </div>
    </Show>
    </div>
  )
}

/** The side panel render every file tab and the "Open file" launcher share. */
export default function FileBrowser(props: {
  tab: Accessor<PanelTab>
  session: MountedSession
  screen: SessionScreen
}) {
  const panel = usePanel()
  const shared = useShared()
  const id = () => props.tab().id
  const placeholder = () => !isFileTab(id())
  const empty = new Map<string, ChangeKind>()

  // Keep each file tab's last selection for the moment before a session's file view state loads. The handoff
  // outlives this view: the session's next view reads it.
  createKeyed(
    () => {
      const file = props.screen.file

      if (!file.ready()) return

      const files = Object.fromEntries(
        panel
          .open()
          .filter(isFileTab)
          .map((tab) => {
            const path = fileTabPath(file, tab)
            const selected = file.selection.get(path)

            return [path, selected && "start" in selected && "end" in selected ? selected : null] as const
          }),
      )

      return { session: props.session.key, files }
    },
    (handoff) => shared.handoff.set(handoff.session, handoff.files),
  )

  return (
    <SessionFileBrowserTab
      session={props.session}
      screen={props.screen}
      id={placeholder() ? undefined : id()}
      placeholder={placeholder()}
      active={placeholder() ? undefined : fileTabPath(props.screen.file, id())}
      kinds={empty}
      state={panel.sidebar}
      onSelect={(path) => shared.open(props.session, path, { tab: "preview" })}
      onSelectPermanent={(path) => shared.open(props.session, path)}
      filterRef={(element) => {
        shared.filter.element = element

        if (!shared.filter.pending) return
        shared.filter.pending = false
        queueMicrotask(() => element.focus())
      }}
    />
  )
}
