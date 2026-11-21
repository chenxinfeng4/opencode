export * as Credential from "./credential.js"

import { Context, Effect, Layer, Schema } from "effect"
import { Credential } from "@opencode/schema/credential"
import { Integration } from "@opencode/schema/integration"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

export const ID = Credential.ID
export type ID = Credential.ID

export const OAuth = Credential.OAuth
export type OAuth = Credential.OAuth

export const Key = Credential.Key
export type Key = Credential.Key

export const External = Credential.External
export type External = Credential.External

export const Value = Credential.Value
export type Value = Credential.Value

export const Event = Credential.Event

export class Info extends Schema.Class<Info>("Credential.Info")({
  id: ID,
  integrationID: Integration.ID,
  label: Schema.String,
  value: Value,
}) {}

export interface Interface {
  /** Returns every stored credential. */
  readonly all: () => Effect.Effect<Info[]>
  /** Returns stored credentials belonging to one integration. */
  readonly list: (integrationID: Integration.ID) => Effect.Effect<Info[]>
  /** Returns one stored credential by ID. */
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  /**
   * Creates a credential for an integration and returns the new record. The new credential becomes the
   * integration's selection unless `activate` is false and the integration already has a credential.
   */
  readonly create: (input: {
    readonly id?: ID
    readonly integrationID: Integration.ID
    readonly value: Value
    readonly label?: string
    readonly activate?: boolean
  }) => Effect.Effect<Info>
  /** Selects a stored credential for its integration. */
  readonly activate: (id: ID) => Effect.Effect<void>
  /** Updates the label or secret value of a stored credential. */
  readonly update: (id: ID, updates: Partial<Pick<Info, "label" | "value">>) => Effect.Effect<void>
  /** Removes a stored credential. */
  readonly remove: (id: ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Credential") {}

// Credentials are disabled for this offline build: providers authenticate from opencode.json only.
const layer = Layer.succeed(
  Service,
  Service.of({
    all: () => Effect.succeed([]),
    list: () => Effect.succeed([]),
    get: () => Effect.succeed(undefined),
    create: (input) =>
      Effect.succeed(
        new Info({
          id: input.id ?? ID.create(),
          integrationID: input.integrationID,
          label: input.label ?? "API key",
          value: input.value,
        }),
      ),
    activate: () => Effect.void,
    update: () => Effect.void,
    remove: () => Effect.void,
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
