import { createEffect, onCleanup } from "solid-js"
import { highlightCode, languageForPath } from "@opencode/ui/context/code-highlight"

const styles = `
[data-component="code-editor"] .code-editor-highlight .shiki {
  background: transparent !important;
  color: inherit;
  margin: 0;
  padding: 0;
  font: inherit;
  line-height: inherit;
  tab-size: 2;
}
[data-component="code-editor"] .code-editor-highlight .shiki code {
  font: inherit;
  line-height: inherit;
}
`

/** A textarea with a syntax-highlighted layer behind it, keeping the caret and selection editable. */
export function CodeEditor(props: {
  value: string
  path: string
  class?: string
  onInput: (value: string) => void
}) {
  let highlight: HTMLDivElement | undefined
  let textarea: HTMLTextAreaElement | undefined
  let token = 0

  const sync = () => {
    if (!highlight || !textarea) return

    highlight.scrollTop = textarea.scrollTop
    highlight.scrollLeft = textarea.scrollLeft
  }

  const render = async (value: string) => {
    const current = ++token
    const html = await highlightCode(value, languageForPath(props.path))

    if (current !== token || !highlight) return
    highlight.innerHTML = html
    sync()
  }

  createEffect(() => {
    void render(props.value)
  })

  onCleanup(() => {
    token++
  })

  return (
    <div data-component="code-editor" class={`relative min-h-0 ${props.class ?? ""}`}>
      <style>{styles}</style>
      <div
        ref={highlight}
        aria-hidden="true"
        class="code-editor-highlight pointer-events-none absolute inset-0 m-0 overflow-hidden p-3 font-mono text-[13px] leading-5"
        style={{ "tab-size": "2" }}
      />
      <textarea
        ref={textarea}
        class="absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent p-3 font-mono text-[13px] leading-5 text-transparent outline-none"
        style={{ "caret-color": "var(--v2-text-text-base)", "tab-size": "2" }}
        value={props.value}
        wrap="off"
        spellcheck={false}
        autocapitalize="off"
        autocomplete="off"
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onScroll={sync}
      />
    </div>
  )
}
