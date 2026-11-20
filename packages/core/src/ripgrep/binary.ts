import path from "path"
import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { which } from "../util/which.js"
import binding from "./vendor-binding.js"

export namespace RipgrepBinary {
  interface Interface {
    readonly filepath: Effect.Effect<string, Error>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/RipgrepBinary") {}

  const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const global = yield* Global.Service
      const findExecutable = (name: string) => which(name, undefined, global.bin)

      // A string binding points into a source checkout's vendor directory; an
      // object binding is an embedded asset of a compiled binary exposed on a
      // virtual path that must be materialized before it can be executed.
      const vendored = typeof binding === "string" ? binding : undefined
      const embedded = typeof binding === "object" ? binding.path : undefined

      return Service.of({
        // Resolution order: system PATH, then the global bin cache, then the
        // vendored/embedded binary. No network fallback.
        filepath: yield* Effect.cached(
          Effect.gen(function* () {
            const executable = process.platform === "win32" ? "rg.exe" : "rg"

            const system = yield* Effect.sync(() => findExecutable(executable))
            if (system && (yield* fs.isFile(system).pipe(Effect.orDie))) return system

            const target = path.join(global.bin, executable)
            if (yield* fs.isFile(target).pipe(Effect.orDie)) return target

            if (vendored && (yield* fs.isFile(vendored).pipe(Effect.orDie))) {
              yield* fs.chmod(vendored, 0o755).pipe(Effect.ignore)
              return vendored
            }

            if (embedded) {
              const directory = path.join(global.bin, "opencode-rg")
              const destination = path.join(directory, executable)
              if (!(yield* fs.isFile(destination).pipe(Effect.orDie))) {
                yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.orDie)
                // Embedded assets live on Bun's virtual filesystem; read them
                // through Bun.file (node-level copy is unreliable there) and
                // materialize a real executable in the global bin cache.
                const bytes = yield* Effect.promise(() => Bun.file(embedded).arrayBuffer())
                const temporary = `${destination}.${process.pid}.tmp`
                yield* fs.writeFile(temporary, new Uint8Array(bytes)).pipe(Effect.orDie)
                yield* fs.chmod(temporary, 0o755).pipe(Effect.orDie)
                yield* fs.rename(temporary, destination).pipe(Effect.orDie)
              }
              return destination
            }

            return yield* Effect.fail(
              new Error(
                "ripgrep (rg) was not found on PATH, in the opencode bin directory, or embedded in this binary. Install ripgrep to enable content search.",
              ),
            )
          }),
        ),
      })
    }),
  )

  export const node = makeGlobalNode({
    service: Service,
    layer: layer,
    deps: [FSUtil.node, Global.node],
  })
}
