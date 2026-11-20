/**
 * The addresses another device on the network can open to reach this machine's server. An empty list while the
 * server only listens on loopback.
 */
export function reachableAddresses(urls: readonly string[]) {
  return urls.flatMap((value) => {
    const url = URL.parse(value)

    return url && !isLoopback(url.hostname) ? [url.origin] : []
  })
}

function isLoopback(hostname: string) {
  return (
    hostname === "localhost" || hostname.endsWith(".localhost") || hostname.startsWith("127.") || hostname === "[::1]"
  )
}
