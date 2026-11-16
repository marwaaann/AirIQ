#!/usr/bin/env node
/**
 * Secret guard, run by the pre-commit hook (.githooks/pre-commit) and CI.
 * No dependencies. Fails (exit 1) when:
 *  - .env.example has a non-empty value after "=" (it is a template; real keys go in .env.local);
 *  - any tracked file (as staged in the index) contains something shaped like a key:
 *    a Google API key (AIza…), a long hex string (WAQI tokens are 40 hex, OpenAQ keys 64),
 *    or a long high-entropy base64/base64url string.
 * Matched values are never printed: only file, line and kind.
 *
 * A line can opt out with the marker `secret-scan: allow` (for test fixtures that must
 * contain key-shaped strings). Lockfiles are skipped (their integrity hashes are base64).
 *
 * Usage: node scripts/check-secrets.mjs            (scans the git index)
 *        node scripts/check-secrets.mjs --worktree (scans tracked files on disk)
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ALLOW_MARKER = "secret-scan: allow";
const SKIP_FILES = new Set(["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"]);
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|avif|woff2?|ttf|otf|eot|pdf|zip|gz|mp4|webm|wasm)$/i;

/** Patterns for key-shaped strings. Order matters: the first match on a span wins. */
export const PATTERNS = [
  { kind: "google-api-key", re: /AIza[0-9A-Za-z_-]{30,}/g },
  { kind: "long-hex", re: /(?<![0-9A-Za-z])[0-9a-fA-F]{32,}(?![0-9A-Za-z])/g },
  { kind: "long-base64", re: /(?<![0-9A-Za-z+/_-])[A-Za-z0-9+/_-]{40,}={0,2}(?![0-9A-Za-z+/_-])/g, check: looksRandom },
];

function entropy(s) {
  const counts = new Map();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
}

/** A base64 candidate must mix upper, lower and digits and look random (not a word-ish path or identifier). */
export function looksRandom(s) {
  const body = s.replace(/=+$/, "");
  if (!/[A-Z]/.test(body) || !/[a-z]/.test(body) || !/[0-9]/.test(body)) return false;
  const digits = body.replace(/[^0-9]/g, "").length;
  if (digits < 4) return false;
  return entropy(body) >= 4.2;
}

/** Findings for .env.example: every assignment must be empty. */
export function checkEnvExample(text, path = ".env.example") {
  const findings = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m) return;
    const value = m[2].replace(/\s+#.*$/, "").trim().replace(/^(['"])(.*)\1$/, "$2").trim();
    if (value !== "") findings.push({ path, line: i + 1, kind: `non-empty value for ${m[1]}` });
  });
  return findings;
}

/** Findings for one file's text. */
export function scanText(text, path) {
  const findings = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    const taken = [];
    for (const { kind, re, check } of PATTERNS) {
      re.lastIndex = 0;
      for (const m of line.matchAll(re)) {
        const start = m.index, end = start + m[0].length;
        if (taken.some(([a, b]) => start < b && end > a)) continue;
        if (check && !check(m[0])) continue;
        taken.push([start, end]);
        findings.push({ path, line: i + 1, kind });
      }
    }
  });
  return findings;
}

export function shouldSkip(path) {
  const base = path.split("/").pop();
  return SKIP_FILES.has(base) || BINARY_EXT.test(path);
}

/** Tracked files with their staged content (or the working-tree content with `worktree`). */
function trackedFiles(worktree) {
  const ls = spawnSync("git", ["ls-files", "-s", "-z"], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (ls.status !== 0) throw new Error("git ls-files failed");
  const entries = ls.stdout.split("\0").filter(Boolean).map((e) => {
    const [meta, path] = e.split("\t");
    const [mode, oid] = meta.split(" ");
    return { mode, oid, path };
  }).filter((e) => e.mode !== "160000" && e.mode !== "120000" && !shouldSkip(e.path));
  if (worktree) {
    return entries.flatMap((e) => {
      try { return [{ path: e.path, text: readFileSync(e.path, "utf8") }]; } catch { return []; }
    });
  }
  const cat = spawnSync("git", ["cat-file", "--batch"], { input: entries.map((e) => e.oid).join("\n") + "\n", maxBuffer: 256 << 20 });
  if (cat.status !== 0) throw new Error("git cat-file failed");
  const out = cat.stdout;
  const files = [];
  let pos = 0;
  for (const e of entries) {
    const nl = out.indexOf(0x0a, pos);
    const size = Number(out.subarray(pos, nl).toString("utf8").split(" ")[2]);
    const body = out.subarray(nl + 1, nl + 1 + size);
    pos = nl + 1 + size + 1;
    if (body.includes(0)) continue; // binary
    files.push({ path: e.path, text: body.toString("utf8") });
  }
  return files;
}

export function scanFiles(files) {
  const findings = [];
  for (const { path, text } of files) {
    if (path === ".env.example" || path.endsWith("/.env.example")) findings.push(...checkEnvExample(text, path));
    findings.push(...scanText(text, path));
  }
  return findings;
}

function main() {
  const worktree = process.argv.includes("--worktree");
  const files = trackedFiles(worktree);
  const findings = scanFiles(files);
  if (findings.length === 0) {
    console.log(`check-secrets: ${files.length} tracked files clean.`);
    return 0;
  }
  console.error(`check-secrets: ${findings.length} possible secret(s) found (values not shown):`);
  for (const f of findings) console.error(`  ${f.path}:${f.line}  ${f.kind}`);
  console.error("Move real keys to .env.local (git-ignored). For a deliberate test string, add the marker \"secret-scan: allow\" on that line.");
  return 1;
}

const norm = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
if (process.argv[1] && norm(fileURLToPath(import.meta.url)) === norm(process.argv[1])) process.exitCode = main();
