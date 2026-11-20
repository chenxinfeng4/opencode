import { expect, test } from "bun:test"
import { reachableAddresses } from "./addresses"

test.each([
  [
    "the addresses other devices can reach",
    ["http://127.0.0.1:49374", "http://192.168.10.248:49374", "http://100.87.251.43:49374"],
    ["http://192.168.10.248:49374", "http://100.87.251.43:49374"],
  ],
  ["nothing while the server only listens on loopback", ["http://127.0.0.1:49374", "http://localhost:49374"], []],
  ["nothing from a malformed address", ["not a url"], []],
])("reachable addresses: %s", (_, urls, expected) => {
  expect(reachableAddresses(urls)).toEqual(expected)
})
