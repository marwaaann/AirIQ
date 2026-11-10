import path from "node:path";
import type { NextConfig } from "next";

/**
 * Version of this build, inlined into the client bundle at build time. The
 * service worker is registered as /sw.js?v=<version>, so every deploy installs
 * a new worker with new cache names, and the old caches are deleted.
 */
const BUILD_VERSION = process.env.AIRIQ_BUILD_VERSION?.trim() || Date.now().toString(36);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    AIRIQ_BUILD_VERSION: BUILD_VERSION,
  },
  // Pin the workspace root to this project. Without it, a stray lockfile in a
  // parent folder (e.g. the user's home directory) can make Turbopack treat
  // that folder as the root and watch far more than the project.
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=()" },
        ],
      },
      {
        // The worker and its helper must never be served from the HTTP cache,
        // or a deploy could keep running the old worker.
        source: "/(sw.js|sw-core.js)",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
