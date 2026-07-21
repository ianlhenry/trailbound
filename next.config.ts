import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // better-sqlite3 is local-dev / ingest only; Cloudflare uses D1.
  serverExternalPackages: ["better-sqlite3"],
};

initOpenNextCloudflareForDev();

export default nextConfig;
