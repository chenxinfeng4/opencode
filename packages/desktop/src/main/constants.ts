import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod"

const raw = import.meta.env.OPENCODE_CHANNEL

export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" ? raw : "prod"

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

// This fork ships a single prod identity: no channel suffixes on the name, id, or data directory.
export const APP_NAME = "OpenCode"

export const APP_ID = "ai.opencode.desktop"
