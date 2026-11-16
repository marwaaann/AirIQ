/**
 * scripts/check-secrets.mjs: the .env.example rule, key-shaped patterns, and
 * an end-to-end run in a throwaway git repo that must fail without printing
 * the value. Key-shaped strings are assembled at runtime so this file itself
 * stays clean for the scanner.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { checkEnvExample, scanText, scanFiles, looksRandom, shouldSkip } from "../../scripts/check-secrets.mjs";

const HEX40 = "3f9a" + "c2d7e18b".repeat(4) + "5e04"; // WAQI token shape
const HEX64 = ["f0e1d2c3b4a59687", "7869504a3b2c1d0e", "a1b2c3d4e5f60718", "293a4b5c6d7e8f90"].join(""); // OpenAQ key shape
const GOOGLE = "AIza" + "SyD4k9Lq2Xv7Bn3Mw8" + "Rt1Zp6Yh0Jc5Fe_-Gu2";
const B64 = "Zq8Xv2Lm9Tr4Ws7Kp1Nb" + "6Hy3Jd5Fg0Qe8Uc2Ri7O";

type Finding = { path: string; line: number; kind: string };
const kinds = (f: Finding[]) => f.map((x) => x.kind);

describe("check-secrets: .env.example must be a template", () => {
  it("accepts empty values, quotes, comments and blank lines", () => {
    const text = ["# WAQI token", "WAQI_TOKEN=", 'GEMINI_API_KEY=""', "OPENAQ_API_KEY= # free key: https://x", "", "export EMPTY=  "].join("\n");
    assert.deepEqual(checkEnvExample(text), []);
  });
  it("flags any non-empty value, naming the variable but not the value", () => {
    const text = ["WAQI_TOKEN=", `OPENAQ_API_KEY= ${HEX64}`, "GEMINI_MODEL=gemini-flash", "\r"].join("\r\n");
    const f: Finding[] = checkEnvExample(text);
    assert.deepEqual(f.map((x) => [x.line, x.kind]), [
      [2, "non-empty value for OPENAQ_API_KEY"],
      [3, "non-empty value for GEMINI_MODEL"],
    ]);
    assert.ok(!JSON.stringify(f).includes(HEX64));
  });
});

describe("check-secrets: key-shaped strings", () => {
  it("finds Google keys, 40- and 64-char hex tokens and random base64", () => {
    assert.deepEqual(kinds(scanText(`const k = "${GOOGLE}";`, "a.ts")), ["google-api-key"]);
    assert.deepEqual(kinds(scanText(`token=${HEX40}`, "a.ts")), ["long-hex"]);
    assert.deepEqual(kinds(scanText(`key: '${HEX64}'`, "a.ts")), ["long-hex"]);
    assert.deepEqual(kinds(scanText(`Authorization: Bearer ${B64}==`, "a.ts")), ["long-base64"]);
  });
  it("reports file and line only", () => {
    const f: Finding[] = scanText(`ok\n\nx=${HEX64}`, "lib/x.ts");
    assert.deepEqual(f, [{ path: "lib/x.ts", line: 3, kind: "long-hex" }]);
  });
  it("ignores ordinary code, short hashes, URLs and word-like identifiers", () => {
    const text = [
      "const NEXT_PUBLIC_SOME_VERY_LONG_IDENTIFIER_NAME_HERE = 1;",
      "commit f3dc8eb and colour #d7191c",
      "https://web.archive.org/web/20160417204306/http://www.cpcb.nic.in/FINAL-REPORT_AQI_.pdf",
      "components/compare/CompareCard/withAVeryLongComponentNameThatIsNotRandom.tsx",
      'd="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"',
    ].join("\n");
    assert.deepEqual(scanText(text, "a.tsx"), []);
    assert.equal(looksRandom("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN"), false); // no digits
  });
  it("honours the allow marker on that line only", () => {
    const f: Finding[] = scanText(`a = "${HEX64}" // secret-scan: allow\nb = "${HEX64}"`, "t.ts");
    assert.deepEqual(f.map((x) => x.line), [2]);
  });
  it("skips lockfiles and binaries; scanFiles applies the .env.example rule", () => {
    assert.equal(shouldSkip("package-lock.json"), true);
    assert.equal(shouldSkip("public/icon.png"), true);
    assert.equal(shouldSkip("lib/x.ts"), false);
    const f: Finding[] = scanFiles([{ path: ".env.example", text: "WAQI_TOKEN=abc" }, { path: "README.md", text: "WAQI_TOKEN=abc" }]);
    assert.deepEqual(f.map((x) => x.path), [".env.example"]);
  });
});

describe("check-secrets: end to end in a git repo", () => {
  const script = resolve("scripts/check-secrets.mjs");
  const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" });
  const hasGit = git(".", "--version").status === 0;

  it("fails on a staged key in .env.example and never prints it", { skip: !hasGit && "git not available" }, () => {
    const dir = mkdtempSync(join(tmpdir(), "airiq-secrets-"));
    try {
      git(dir, "init", "-q");
      writeFileSync(join(dir, ".env.example"), `WAQI_TOKEN=\nOPENAQ_API_KEY=${HEX64}\n`);
      writeFileSync(join(dir, "notes.md"), `token ${HEX40}\n`);
      git(dir, "add", "-A");
      const r = spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" });
      assert.equal(r.status, 1);
      const out = r.stdout + r.stderr;
      assert.match(out, /\.env\.example:2 {2}non-empty value for OPENAQ_API_KEY/);
      assert.match(out, /\.env\.example:2 {2}long-hex/);
      assert.match(out, /notes\.md:1 {2}long-hex/);
      assert.ok(!out.includes(HEX64) && !out.includes(HEX40), "matched values must not be printed");

      // Fixed in the index: passes.
      writeFileSync(join(dir, ".env.example"), "WAQI_TOKEN=\nOPENAQ_API_KEY=\n");
      writeFileSync(join(dir, "notes.md"), "token in .env.local\n");
      git(dir, "add", "-A");
      const ok = spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" });
      assert.equal(ok.status, 0, ok.stderr);
      assert.match(ok.stdout, /2 tracked files clean/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
