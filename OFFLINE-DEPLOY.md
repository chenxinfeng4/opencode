# Offline deployment (air-gapped intranet)

This fork runs fully offline: no update checks, no catalog polling, no telemetry,
and the web UI and ripgrep are embedded in the release binary. The TUI highlights
only the opentui built-ins (markdown, javascript, typescript); additional
tree-sitter language support was dropped to keep the binary small.

The OpenTunnel remote-access feature (the public tunnel behind `opencode pair
--remote` and `opencode service set remote`) has been removed entirely: the
server can only be reached on the networks it binds to. Desktop builds perform
no update checks at all; set `OPENCODE_UPDATE_URL` in the environment to point
the desktop updater at your own mirror (it must serve the electron-updater feed
and the stable artifact manifest).

## On an internet-connected machine

```sh
git clone <this repo> opencode && cd opencode
bun install
bun run vendor            # downloads ripgrep + tree-sitter assets (gitignored)
bun run package-offline   # builds the single-file binary and packs artifacts/
```

`bun run package-offline` produces `artifacts/opencode-offline-<version>.tar.gz`
containing the compiled `opencode` binary and a copy of this guide. Re-run
`bun run vendor` when the ripgrep version changes; the vendored files can also
be copied between machines.

## On the intranet machine

```sh
tar -xzf opencode-offline-<version>.tar.gz && cd opencode-offline
OPENCODE_SERVER_PASSWORD=<secret> ./opencode serve --hostname 0.0.0.0 --port 4097
```

- The web UI is served from inside the binary at `http://<host>:4097` — no
  additional files, Node.js, or Bun installation are required.
- Content search uses the embedded ripgrep binary automatically; a system `rg`
  on PATH still takes precedence.
- Providers are configured with API keys only. The provider catalog is the
  domestic snapshot embedded at build time
  (`packages/core/src/models-dev/snapshot.txt`); to change it, edit the snapshot
  and rebuild on the internet-connected machine.

## Windows desktop installer (cross-built on Linux)

The desktop installer (`opencode-desktop-win-x64.exe`) can be produced on the
same internet-connected Linux machine. The only out-of-repo download is the
Bun Windows compile stub, cached in `packages/cli/dist/.bun/` (gitignored).

1. Compile the Windows CLI (`--skip-install` skips platform package installs;
   the web UI archive is rebuilt automatically and must not be skipped):

   ```sh
   cd packages/cli
   BUN_COMPILE_RELEASE=bun-v1.4.2 bun script/build.ts \
     --target=opencode-windows-x64-baseline --skip-install
   ```

   The Bun stub is cached under `dist/.bun/bun-v1.4.2/`. If the automatic
   download fails (TLS interception), pre-seed it manually:

   ```sh
   curl -fLo /tmp/bun-windows-x64-baseline.zip \
     https://gh-proxy.org/https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-windows-x64-baseline.zip
   mkdir -p dist/.bun/bun-v1.4.2 && unzip -oq /tmp/bun-windows-x64-baseline.zip -d dist/.bun/bun-v1.4.2/
   ```

2. Inject the CLI into the desktop resources. The dev channel's prebuild step
   downloads the upstream CLI from npm, so inject manually instead:

   ```sh
   cd packages/desktop
   bun ./scripts/copy-icons.ts dev
   bun ./scripts/copy-metainfo.ts dev
   cp ../cli/dist/cli-windows-x64-baseline/bin/opencode.exe resources/opencode-cli.exe
   bun -e 'Bun.write("resources/opencode-cli.version", require("../cli/dist/cli-windows-x64-baseline/package.json").version)'
   ```

   Set the desktop `package.json` version to the same CLI version (CI does
   this in `prepare.ts`); it feeds the installer's product version metadata.
   Channel icons need a ≥256px layer in `icon.ico` for electron-builder; the
   dev icon was regenerated from `icons/dev/128x128@2x.png` with
   `convert ... -define icon:auto-resize=256,128,64,48,32,16`.

3. Build the renderer and package. Invoke `electron-vite` directly — `bun run
   build` would fire the `prebuild` hook first, which re-downloads the
   upstream CLI into `resources/opencode-cli` on the dev channel:

   ```sh
   cd packages/desktop
   NODE_OPTIONS=--max-old-space-size=4096 OPENCODE_CHANNEL=dev \
     OPENCODE_VERSION=<cli-version> ./node_modules/.bin/electron-vite build

   ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
   ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
   OPENCODE_CHANNEL=dev OPENCODE_CLI_TARGET=x86_64-pc-windows-msvc \
   ./node_modules/.bin/electron-builder --win --publish never \
     --config electron-builder.config.ts
   ```

   The NSIS uninstaller is extracted natively on non-Windows hosts
   (`patches/app-builder-lib*.patch` widens electron-builder's
   `UninstallerReader` path beyond macOS Catalina), so no wine install is
   needed. The artifact lands at
   `packages/desktop/dist/opencode-desktop-win-x64.exe`. Code signing is
   skipped on non-Windows hosts (`signExecutable: false` in
   `electron-builder.config.ts`), so the installer is unsigned — expected for
   intranet deployment.
