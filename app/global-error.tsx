"use client";

/**
 * Last-resort boundary for errors in the root layout. It replaces the whole
 * document, so it carries its own minimal styles (global CSS is not loaded)
 * and follows the OS colour scheme.
 */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          background: "Canvas",
          color: "CanvasText",
          colorScheme: "light dark",
        }}
      >
        <title>Something went wrong · AirIQ</title>
        <main role="alert" style={{ maxWidth: 480, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 28, margin: "0 0 12px" }}>AirIQ couldn&rsquo;t load</h1>
          <p style={{ margin: "0 0 20px", lineHeight: 1.5 }}>An unexpected error stopped the app from starting. Please try again.</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={() => retry()} style={{ font: "inherit", fontWeight: 600, padding: "8px 16px", borderRadius: 8, cursor: "pointer" }}>
              Try again
            </button>
            {/* A full page load, since the client router may be the thing that failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ font: "inherit", padding: "8px 16px", color: "LinkText" }}>
              Go to the dashboard
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
