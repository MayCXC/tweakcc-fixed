// Tests must never touch the network: a real request makes timing depend on
// DNS/TLS and fails offline. Plain assignment (not vi.stubGlobal) so an
// unstubGlobals setting cannot restore the real fetch.
globalThis.fetch = (input: string | URL | Request): Promise<Response> =>
  Promise.reject(
    new Error(
      `network is disabled in tests; mock fetch (requested ${String(
        input instanceof Request ? input.url : input
      )})`
    )
  );
