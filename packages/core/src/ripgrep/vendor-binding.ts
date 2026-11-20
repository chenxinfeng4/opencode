import path from "path"

// Resolves the vendored ripgrep binary. During `bun build --compile` the build
// script replaces this module with an embedded `with { type: "file" }` asset
// import, so the compiled binary carries its own ripgrep. In a source checkout
// this points into the gitignored packages/core/vendor directory populated by
// `bun run vendor`; the path may not exist, which the consumer handles.
const TRIPLES: Record<string, string> = {
  "x64-linux": "x86_64-unknown-linux-musl",
  "arm64-linux": "aarch64-unknown-linux-gnu",
  "x64-darwin": "x86_64-apple-darwin",
  "arm64-darwin": "aarch64-apple-darwin",
}

const triple = TRIPLES[`${process.arch}-${process.platform}`]
const binding: string | { readonly path: string } | undefined = triple
  ? path.join(import.meta.dir, "..", "..", "vendor", "ripgrep", triple, process.platform === "win32" ? "rg.exe" : "rg")
  : undefined

export default binding
