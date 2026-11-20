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
