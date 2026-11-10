// Test-only Node resolve hook so server modules can be imported under `node --test`:
// "@/x" → <project>/x(.ts|.tsx), "server-only" → empty module, "next/server" → next/server.js.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
  if (specifier === "next/server") return next("next/server.js", context);
  if (specifier.startsWith("@/")) {
    const base = join(ROOT, specifier.slice(2));
    for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
      if (existsSync(cand)) return { url: pathToFileURL(cand).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
