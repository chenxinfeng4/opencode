#!/usr/bin/env bun
// Builds the single-file opencode binary with embedded web UI and ripgrep, then
// packs it into artifacts/opencode-offline-<version>.tar.gz for air-gapped
// deployment. See OFFLINE-DEPLOY.md.

import { $ } from "bun"

const root = new URL("..", import.meta.url).pathname
const pkg = await Bun.file(root + "package.json").json()
const version: string = pkg.version ?? "0.0.0"
const outDir = root + "artifacts/"
const bundle = `opencode-offline-${version}.tar.gz`

const vendorRg = root + "packages/core/vendor/ripgrep"
const missing: string[] = []
if (!(await Bun.file(vendorRg + "/x86_64-unknown-linux-musl/rg").exists()))
  missing.push("packages/core/vendor/ripgrep — run `bun run vendor`")
if (missing.length > 0) {
  for (const item of missing) console.error(`  ! ${item}`)
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

await $`mkdir -p ${outDir}opencode-offline`.quiet()
await $`cp ${binary} ${outDir}opencode-offline/opencode`.quiet()
await $`cp ${root}OFFLINE-DEPLOY.md ${outDir}opencode-offline/`.quiet()
await $`tar -czf ${outDir}${bundle} -C ${outDir} opencode-offline`.quiet()
await $`rm -rf ${outDir}opencode-offline ${root}packages/cli/.cache/offline-build`.quiet()

const size = (await Bun.file(outDir + bundle).size) / 1024 / 1024
console.log(`\n${outDir}${bundle} (${size.toFixed(0)} MB)`)
console.log("Copy this file to the intranet and follow OFFLINE-DEPLOY.md inside.")
