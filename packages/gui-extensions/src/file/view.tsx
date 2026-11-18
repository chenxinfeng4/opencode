import { createMemo, createSignal, Match, onCleanup, Show, Switch } from "solid-js"
import { Dynamic } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FileSearchHandle } from "@opencode/session-ui/file"
import { useFileComponent } from "@opencode/ui/context/file"
import { sampledChecksum } from "@opencode/util/encode"
import { ScrollView } from "@opencode/ui/scroll-view"
import { createKeyed, useExtension, type LineRange, type MountedSession, type SessionScreen } from "../sdk"
import { artifactKind } from "@opencode/util/artifact"
import ArtifactView from "./artifact-view"
import { CodeEditor } from "./code-editor"
import { useShared } from "./context"
import { fileTabPath } from "./path"

type ScrollPos = { x: number; y: number }

type ScrollSyncState = { scroll?: HTMLDivElement; scrollFrame?: number; restoreFrame?: number; pending?: ScrollPos }

type FindState = { find: FileSearchHandle | null }

function createScrollSync(input: { get: () => ScrollPos | undefined; set: (pos: ScrollPos) => void }) {
  const state: ScrollSyncState = {}
  const [code, setCode] = createSignal<HTMLElement[]>([])

  const getCode = () => {
    const el = state.scroll

    if (!el) return []

    const host = el.querySelector("diffs-container")

    if (!(host instanceof HTMLElement)) return []

    const root = host.shadowRoot

    if (!root) return []

    return Array.from(root.querySelectorAll("[data-code]")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node.clientWidth > 0,
    )
  }

  const save = (next: ScrollPos) => {
    state.pending = next

    if (state.scrollFrame !== undefined) return

    state.scrollFrame = requestAnimationFrame(() => {
      state.scrollFrame = undefined

      const out = state.pending
      state.pending = undefined

      if (!out) return

      input.set(out)
    })
  }

  const onCodeScroll = (event: Event) => {
    const el = state.scroll

    if (!el) return

    const target = event.currentTarget

    if (!(target instanceof HTMLElement)) return

    save({
      x: target.scrollLeft,
      y: el.scrollTop,
    })
  }

  const sync = () => {
    const next = getCode()
    const current = code()

    if (next.length === current.length && next.every((el, i) => el === current[i])) return
    setCode(next)
  }

  const restore = () => {
    const el = state.scroll

    if (!el) return

    const pos = input.get()

    if (!pos) return

    sync()

    if (code().length > 0) {
      for (const item of code()) {
        if (item.scrollLeft !== pos.x) item.scrollLeft = pos.x
      }
    }

    if (el.scrollTop !== pos.y) el.scrollTop = pos.y

    if (code().length > 0) return

    if (el.scrollLeft !== pos.x) el.scrollLeft = pos.x
  }

  const queueRestore = () => {
    if (state.restoreFrame !== undefined) return

    state.restoreFrame = requestAnimationFrame(() => {
      state.restoreFrame = undefined
      restore()
    })
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (code().length === 0) sync()

    save({
      x: code()[0]?.scrollLeft ?? event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    })
  }

  // The diff's code columns scroll on their own; listen to the ones on screen.
  createKeyed(code, (items) => items.forEach((item) => makeEventListener(item, "scroll", onCodeScroll)))

  const setViewport = (el: HTMLDivElement) => {
    state.scroll = el
    restore()
  }

  onCleanup(() => {
    if (state.scrollFrame !== undefined) cancelAnimationFrame(state.scrollFrame)

    if (state.restoreFrame !== undefined) cancelAnimationFrame(state.restoreFrame)
  })

  return {
    handleScroll,
    queueRestore,
    setViewport,
  }
}

export function SessionFileView(props: { session: MountedSession; screen: SessionScreen; id: string }) {
  const ctx = useExtension()
  const layout = ctx.layout
  const shared = useShared()
  const fileComponent = useFileComponent()
  const file = props.screen.file
  // The stored side tab key doubles as the scroll key, as it did before extensions.
  const key = () => `file:${props.id}`
  const active = () => shared.active(props.session, props.id)

  const state: FindState = { find: null }

  const search = {
    register: (handle: FileSearchHandle | null) => {
      state.find = handle
    },
  }

  const path = createMemo(() => fileTabPath(file, props.id))

  const current = createMemo(() => {
    const p = path()

    if (!p) return

    return file.get(p)
  })

  const contents = createMemo(() => current()?.content?.content ?? "")
  const cacheKey = createMemo(() => sampledChecksum(contents()))

  // Plain text keeps the code view; every other kind is rendered by ArtifactView.
  const artifact = createMemo(() => {
    const content = current()?.content

    return content?.type === "binary" || artifactKind(path() ?? "") !== "text"
  })

  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [saveError, setSaveError] = createSignal<string>()

  const beginEdit = () => {
    if (artifact()) return
    setDraft(contents())
    setSaveError(undefined)
    setEditing(true)
  }

  const save = async () => {
    const target = path()

    if (!target || saving()) return
    setSaving(true)
    setSaveError(undefined)

    try {
      await file.write(target, new TextEncoder().encode(draft()))
      await file.sync(target, { force: true })
      setEditing(false)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const cancel = () => {
    setEditing(false)
    setSaveError(undefined)
  }

  makeEventListener(
    window,
    "keydown",
    (event: KeyboardEvent) => {
      if (!editing()) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      if (event.key.toLowerCase() !== "s") return

      event.preventDefault()
      event.stopPropagation()
      void save()
    },
    { capture: true },
  )

  const selectedLines = createMemo<LineRange | null>(() => {
    const p = path()

    if (!p) return null

    if (file.ready()) return file.selection.get(p) ?? null

    return shared.handoff.get(props.session.key, p) ?? null
  })

  const scrollSync = createScrollSync({
    get: () => layout.scroll.get(props.session, key()),
    set: (pos) => layout.scroll.set(props.session, key(), pos),
  })

  // Mod+F finds in the shown file.
  makeEventListener(
    window,
    "keydown",
    (event: KeyboardEvent) => {
      if (!active()) return

      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return

      if (event.key.toLowerCase() !== "f") return

      event.preventDefault()
      event.stopPropagation()
      state.find?.focus()
    },
    { capture: true },
  )

  const previous = { loaded: false, ready: false, active: false }

  createKeyed(
    () => {
      const p = path()

      return p ? { session: props.session.key, path: p } : undefined
    },
    (target) =>
      onCleanup(
        shared.reveal.register(target.session, target.path, () => {
          scrollSync.queueRestore()
        }),
      ),
    { equals: (previous, next) => previous?.session === next?.session && previous?.path === next?.path },
  )

  // Restores the stored scroll when the file loads, its view state loads, or the tab shows a loaded file again.
  createKeyed(
    () => ({ loaded: !!current()?.loaded, ready: file.ready(), shown: active() }),
    (next) => {
      const restore =
        (next.loaded && !previous.loaded) ||
        (next.ready && !previous.ready) ||
        (next.shown && next.loaded && !previous.active)

      previous.loaded = next.loaded
      previous.ready = next.ready
      previous.active = next.shown

      if (restore) scrollSync.queueRestore()
    },
    {
      // The file's content changing while it stays loaded is the same key.
      equals: (previous, next) =>
        previous.loaded === next.loaded && previous.ready === next.ready && previous.shown === next.shown,
    },
  )

  const renderFile = (source: string) => (
    <div class="relative overflow-hidden pb-40">
      <Dynamic
        component={fileComponent}
        mode="text"
        file={{
          name: path() ?? "",
          contents: source,
          cacheKey: cacheKey(),
        }}
        enableLineSelection
        selectedLines={selectedLines()}
        onRendered={() => {
          scrollSync.queueRestore()
        }}
        search={search}
        class="select-text"
        // Media and previews have their own viewers below; the code view only ever shows text.
        media={{ mode: "off" }}
      />
    </div>
  )

  // The code view scrolls inside ScrollView so line state and scroll position persist per tab.
  const codeView = (source: string) => (
    <ScrollView class="min-h-0 flex-1" viewportRef={scrollSync.setViewport} onScroll={scrollSync.handleScroll}>
      {renderFile(source)}
    </ScrollView>
  )

  return (
    <div class="mt-3 relative h-full min-h-0 flex flex-col">
      <div class="absolute end-2 top-0 z-10 flex items-center gap-1">
        <Show when={!artifact() && !editing()}>
          <button
            type="button"
            class="rounded-md px-2 py-1 text-12-medium text-text-base hover:bg-surface-raised-base-hover"
            onClick={beginEdit}
          >
            {ctx.t("file.edit")}
          </button>
        </Show>
        <Show when={editing()}>
          <button
            type="button"
            class="rounded-md px-2 py-1 text-12-medium text-text-base hover:bg-surface-raised-base-hover disabled:opacity-60"
            disabled={saving()}
            onClick={cancel}
          >
            {ctx.t("file.cancel")}
          </button>
          <button
            type="button"
            class="rounded-md bg-v2-background-bg-accent px-2 py-1 text-12-medium text-v2-text-text-contrast hover:opacity-90 disabled:opacity-60"
            disabled={saving()}
            onClick={() => void save()}
          >
            {saving() ? ctx.t("file.saving") : ctx.t("file.save")}
          </button>
        </Show>
      </div>
      <Show when={saveError()}>
        {(message) => <div class="px-3 py-1 text-12-regular text-text-weak">{message()}</div>}
      </Show>
      <Switch>
        <Match when={current()?.loaded ? current()?.content : undefined}>
          {(value) => (
            <Show
              when={editing() && !artifact()}
              fallback={
                <Show when={artifact()} fallback={codeView(value().content)}>
                  <ArtifactView
                    session={props.session}
                    path={path() ?? ""}
                    content={value()}
                    cacheKey={cacheKey()}
                    source={codeView(value().content)}
                  />
                </Show>
              }
            >
              <div class="min-h-0 flex-1 overflow-hidden rounded-md border border-border-weaker-base">
                <CodeEditor
                  class="h-full"
                  value={draft()}
                  path={path() ?? ""}
                  onInput={(value) => setDraft(value)}
                />
              </div>
            </Show>
          )}
        </Match>
        <Match when={current()?.loading}>
          <div class="px-6 py-4 text-text-weak">{ctx.t("common.loading")}…</div>
        </Match>
        <Match when={current()?.notFound ? current()?.name : undefined}>
          {(name) => <div class="px-6 py-4 text-text-weak">{ctx.t("tab.notFound", { name: name() })}</div>}
        </Match>
        <Match when={current()?.error}>{(err) => <div class="px-6 py-4 text-text-weak">{err()}</div>}</Match>
      </Switch>
    </div>
  )
}
