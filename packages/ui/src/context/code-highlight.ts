import { getSharedHighlighter } from "@pierre/diffs"
import { bundledLanguages, bundledLanguagesInfo, type BundledLanguage } from "shiki"
import { registerOpenCodeTheme } from "./marked-theme-register"

registerOpenCodeTheme()

const LANGUAGE_IDS = new Map<string, string>()

for (const info of bundledLanguagesInfo) {
  LANGUAGE_IDS.set(info.id, info.id)

  for (const alias of info.aliases ?? []) LANGUAGE_IDS.set(alias, info.id)
}

/** The shiki language id for a file path, by extension; `text` when unknown. */
export function languageForPath(path: string) {
  const base = path.split(/[\\/]/).pop() ?? ""
  const index = base.lastIndexOf(".")

  if (index <= 0) return "text"

  return LANGUAGE_IDS.get(base.slice(index + 1).toLowerCase()) ?? "text"
}

/** Highlights text as HTML for the OpenCode theme, leaving grammars behind shiki's lazy imports. */
export async function highlightCode(code: string, language: string) {
  const highlighter = await getSharedHighlighter({
    themes: ["OpenCode"],
    langs: [],
    preferredHighlighter: "shiki-wasm",
  })
  const known = language in bundledLanguages
  const name = (known ? language : "text") as BundledLanguage

  if (known && !highlighter.getLoadedLanguages().includes(name)) await highlighter.loadLanguage(name)

  return highlighter.codeToHtml(code, {
    lang: name,
    theme: "OpenCode",
    tabindex: false,
  })
}
