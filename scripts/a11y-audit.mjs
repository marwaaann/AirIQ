// Accessibility audit: runs axe-core in headless Chrome on every main route,
// in light and dark themes, at desktop and mobile widths.
//
// Usage (against a running production server):
//   npm run build && npm start            # in one terminal
//   node scripts/a11y-audit.mjs http://localhost:3000 [out.json]
//
// Needs Google Chrome. Set CHROME_PATH if it is not in the default location.
// Exit code 1 when any serious or critical violation is found.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const OUT = process.argv[3];
const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const CHROME =
  process.env.CHROME_PATH ||
  (process.platform === "win32"
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "google-chrome");
const PORT = 9400 + Math.floor(Math.random() * 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CITY = "/city/delhi-28.61-77.21";
// [name, path, readiness expression]
const ROUTES = [
  ["home", "/", "document.querySelectorAll('a[href^=\"/city/\"]').length >= 6 && !document.querySelector('.skeleton')"],
  ["city-overview", CITY, "document.body.innerText.includes('Main pollutant')"],
  ["city-forecast", `${CITY}?tab=forecast`, "!!document.querySelector('#panel-forecast .recharts-wrapper')"],
  ["city-history", `${CITY}?tab=history`, "!!document.querySelector('#panel-history .recharts-wrapper')"],
  ["city-health", `${CITY}?tab=health`, "!!document.querySelector('#panel-health') && !document.querySelector('#panel-health .skeleton')"],
  ["city-weather", `${CITY}?tab=weather`, "!!document.querySelector('#panel-weather .recharts-wrapper')"],
  ["map", "/map?lat=28.61&lon=77.21&z=9", "document.querySelectorAll('.leaflet-marker-icon').length > 5"],
  ["compare", "/compare?cities=delhi-28.61-77.21,london-51.51--0.13", "document.querySelectorAll('[data-testid=compare-aqi]').length === 2"],
  ["alerts", "/alerts", "!!document.querySelector('h1')"],
  ["assistant", "/assistant", "!!document.querySelector('textarea')"],
  ["report", `${CITY}/report?range=7`, "!!document.querySelector('[data-testid=report-forecast]')"],
  ["about", "/about", "!!document.querySelector('h1')"],
];
const THEMES = ["light", "dark"];
const VIEWPORTS = [
  ["desktop", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }],
  ["mobile", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }],
];

const profile = mkdtempSync(join(tmpdir(), "airiq-a11y-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"]);
let targets = [];
for (let i = 0; i < 60 && !targets.some((t) => t.type === "page"); i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  } catch {
    await sleep(250);
  }
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++seq;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const waitFor = async (expr, timeout = 45000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evaluate(`(()=>{try{return !!(${expr})}catch{return false}})()`)) return true;
    await sleep(300);
  }
  return false;
};

await send("Page.enable");
await send("Runtime.enable");

const results = [];
for (const theme of THEMES) {
  for (const [vpName, vp] of VIEWPORTS) {
    await send("Emulation.setDeviceMetricsOverride", vp);
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    // Store the theme first so every audited page loads with it.
    await send("Page.navigate", { url: `${BASE}/offline` });
    await sleep(800);
    await evaluate(`localStorage.setItem('airiq:theme', ${JSON.stringify(JSON.stringify(theme))})`);
    for (const [name, path, ready] of ROUTES) {
      await send("Page.navigate", { url: BASE + path });
      await sleep(500);
      const ok = await waitFor(ready);
      await sleep(800);
      await evaluate(AXE);
      const res = await evaluate(
        `axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice'] } }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map(n => ({ target: n.target.join(' '), summary: n.failureSummary.slice(0, 300) })), count: v.nodes.length })))`,
      );
      const actualTheme = await evaluate(`document.documentElement.getAttribute('data-theme')`);
      results.push({ route: name, theme, actualTheme, viewport: vpName, ready: ok, violations: res ?? [] });
      const summary = (res ?? []).map((v) => `${v.impact}:${v.id}(${v.count})`).join(" ") || "none";
      console.log(`${name.padEnd(14)} ${theme.padEnd(5)} ${vpName.padEnd(7)} ready=${ok} ${summary}`);
    }
  }
}

ws.close();
chrome.kill();
await sleep(500);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // Chrome may still hold the profile for a moment; the OS temp cleaner will get it.
}
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
const blocking = results.flatMap((r) => r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${r.route}/${r.theme}/${r.viewport}: ${v.id}`));
console.log(blocking.length ? `\n${blocking.length} serious/critical:\n${blocking.join("\n")}` : "\nNo serious or critical violations.");
process.exit(blocking.length ? 1 : 0);
