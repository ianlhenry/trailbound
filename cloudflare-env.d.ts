/** Cloudflare Worker bindings available via getCloudflareContext().env */
interface CloudflareEnv {
  // D1Database from the Workers runtime; keep loose for Next local typing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  DB: any;
}

export {};
