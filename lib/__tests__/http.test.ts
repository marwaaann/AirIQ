import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { z } from "zod";

register(new URL("./support/alias-loader.mjs", import.meta.url).href);
const { fetchJson } = await import("../http.ts");

describe("upstream fetch caching (regression: hours-old readings)", () => {
  it("never uses Next's persistent fetch cache and de-duplicates within the TTL", async () => {
    const original = globalThis.fetch;
    const inits: RequestInit[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      inits.push(init ?? {});
      return new Response(JSON.stringify({ value: inits.length }), { status: 200 });
    }) as typeof fetch;
    try {
      const schema = z.object({ value: z.number() });
      const url = `https://example.test/a?${Date.now()}`;
      const a = await fetchJson(url, { upstream: "Test", schema, revalidate: 60 });
      const b = await fetchJson(url, { upstream: "Test", schema, revalidate: 60 });
      assert.equal(inits.length, 1, "second call is served by the in-process cache");
      assert.deepEqual(a, b);
      const init = inits[0] as RequestInit & { next?: unknown };
      assert.equal(init.cache, "no-store");
      assert.equal(init.next, undefined, "no next.revalidate (stale-while-revalidate)");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("turns upstream HTTP errors into UpstreamError with the status", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ oops: true }), { status: 429 })) as typeof fetch;
    try {
      await assert.rejects(fetchJson(`https://example.test/b?${Date.now()}`, { upstream: "Test", schema: z.object({}) }), (e: Error & { status?: number }) => {
        return e.name === "UpstreamError" && e.status === 429;
      });
    } finally {
      globalThis.fetch = original;
    }
  });
});
