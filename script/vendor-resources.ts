#!/usr/bin/env bun
// Downloads the gitignored ripgrep binaries vendored under
// packages/core/vendor/ripgrep/. Run once after cloning (`bun run vendor`);
// existing files are kept, so the directory can equally be copied in from
// another machine.

const RG_DIR = new URL("../packages/core/vendor/ripgrep", import.meta.url).pathname

const RG_VERSION = "15.1.0"
const RG_TARGETS = ["x86_64-unknown-linux-musl", "aarch64-unknown-linux-gnu"]

const MIRRORS = ["https://gh-proxy.org/", "https://ghfast.top/", ""]

async function fetchAny(url: string): Promise<ArrayBuffer> {
  let lastError: unknown
  for (const prefix of MIRRORS) {
    try {
      const response = await fetch(prefix + url, { signal: AbortSignal.timeout(120_000) })
      if (response.ok) {
        const body = await response.arrayBuffer()
        if (body.byteLength > 100) return body
      }
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

for (const triple of RG_TARGETS) {
  const target = `${RG_DIR}/${triple}/rg`
  if (await Bun.file(target).exists()) {
    console.log(`ripgrep: ${triple} already vendored`)
    continue
  }
  const archive = `${RG_DIR}/ripgrep-${RG_VERSION}-${triple}.tar.gz`
  await Bun.$`mkdir -p ${RG_DIR}/${triple}`.quiet()
  const body = await fetchAny(
    `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-${triple}.tar.gz`,
  )
  await Bun.write(archive, body)
  await Bun.$`tar -xzf ${archive} -C ${RG_DIR}/${triple} --strip-components 1 ripgrep-${RG_VERSION}-${triple}/rg`.quiet()
  await Bun.$`chmod 755 ${target}`.quiet()
  await Bun.$`rm ${archive}`.quiet()
  console.log(`ripgrep: vendored ${triple}`)
}
