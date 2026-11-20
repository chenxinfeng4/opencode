import { describe, expect, test } from "bun:test"
import parsers from "../../src/parsers-config"
import { filetype } from "../../src/util/filetype"

describe("util.filetype", () => {
  test("maps filenames to presentation languages", () => {
    expect(filetype("component.tsx")).toBe("typescript")
    expect(filetype("script.js")).toBe("typescript")
    expect(filetype("main.py")).toBe("python")
    expect(filetype("README.unknown")).toBeUndefined()
  })

  test("maps shell filenames to bash; no remote parsers are registered", () => {
    const languages = ["script.sh", "script.bash", "script.zsh", "script.ksh"].map(filetype)
    expect(languages).toEqual(["bash", "bash", "bash", "bash"])
    // Remote tree-sitter downloads were removed on purpose: the TUI highlights
    // only the opentui built-ins and fetches nothing at render time.
    expect(parsers.parsers).toEqual([])
  })

  test("uses none for missing filenames", () => {
    expect(filetype()).toBe("none")
    expect(filetype("")).toBe("none")
  })
})
