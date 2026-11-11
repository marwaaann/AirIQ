import path from "node:path";
import type { NextConfig } from "next";

/**
 * Version of this build, inlined into the client bundle at build time. The
 * service worker is registered as /sw.js?v=<version>, so every deploy installs
 * a new worker with new cache names, and the old caches are deleted.
 */
const BUILD_VERSION = process.env.AIRIQ_BUILD_VERSION?.trim() || Date.now().toString(36);

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy. Tested in the browser against the map tiles, the
 * service worker, next/og images, report export and the assistant stream.
 * - 'unsafe-inline' scripts: Next inlines its RSC payload and our pre-paint
 *   theme script; nonces would force every static page to render per request.
 * - 'unsafe-inline' styles: React style props, Leaflet and Recharts set inline styles.
 * - img: Esri basemap tiles; data:/blob: for report export (html-to-image, jsPDF).
 * - connect: own API routes, plus BigDataCloud for "Use my location" place names.
 * - 'unsafe-eval' in development only (React dev tooling).
 */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://server.arcgisonline.com",
  "font-src 'self' data:",
  `connect-src 'self' https://api.bigdatacloud.net${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

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
          { key: "X-Frame-Options", value: "DENY" },
          // Only geolocation (for "Use my location"), and only for this origin.
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=()",
          },
          { key: "Content-Security-Policy", value: CSP },
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
