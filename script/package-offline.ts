#!/usr/bin/env bun
// Builds the single-file opencode binary with embedded web UI and ripgrep for
// air-gapped deployment. The output is the binary itself, with no bundle or docs.

import { $ } from "bun"
import { chmod, rename, rm } from "node:fs/promises"

const root = new URL("..", import.meta.url).pathname
const pkg = await Bun.file(root + "package.json").json()
const version: string = pkg.version ?? "0.0.0"
const outDir = root + "artifacts/"
const target = `${outDir}opencode-offline-${version}`

const vendorRg = root + "packages/core/vendor/ripgrep"
if (!(await Bun.file(vendorRg + "/x86_64-unknown-linux-musl/rg").exists())) {
  console.error("  ! packages/core/vendor/ripgrep — run `bun run vendor`")
  process.exit(1)
}

console.log("building single-file binary (linux-x64, web UI embedded)…")
await $`bun run --cwd packages/cli build --single --skip-install --outdir=.cache/offline-build`
  .cwd(root)
  .throws(true)

const binary = root + "packages/cli/.cache/offline-build/cli-linux-x64/bin/opencode"
if (!(await Bun.file(binary).exists())) {
  console.error(`binary not found at ${binary}`)
  process.exit(1)
}

// Copy beside the target and rename into place so a running copy of an earlier
// binary (ETXTBSY on in-place copy) never blocks packaging.
const temporary = `${target}.${process.pid}.tmp`
await $`mkdir -p ${outDir}`.quiet()
await $`cp ${binary} ${temporary}`.quiet()
await chmod(temporary, 0o755)
await rename(temporary, target)
await rm(root + "packages/cli/.cache/offline-build", { recursive: true, force: true })

const size = (await Bun.file(target).size) / 1024 / 1024
console.log(`\n${target} (${size.toFixed(0)} MB)`)
console.log("Copy this single binary to the intranet and run it directly.")
