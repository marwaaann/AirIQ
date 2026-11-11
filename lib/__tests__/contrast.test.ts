import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { EU_CATEGORIES, US_CATEGORIES } from "../aqi-categories.ts";

/** WCAG 2.x relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Read the theme tokens from app/globals.css so the test follows the real stylesheet. */
function tokens(selector: ":root" | ':root[data-theme="dark"]'): Record<string, string> {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} block not found`);
  const block = css.slice(start, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

describe("AQI category colours (WCAG AA)", () => {
  for (const [scale, cats] of [
    ["US", US_CATEGORIES],
    ["EU", EU_CATEGORIES],
  ] as const) {
    for (const c of cats) {
      it(`${scale} ${c.label}: badge text ${c.textColor} on ${c.color} is at least 4.5:1`, () => {
        const ratio = contrast(c.textColor, c.color);
        assert.ok(ratio >= AA_TEXT, `${ratio.toFixed(2)}:1`);
      });
    }
  }

  it("keeps the official category background colours", () => {
    assert.deepEqual(
      US_CATEGORIES.map((c) => c.color),
      ["#00e400", "#ffff00", "#ff7e00", "#ff0000", "#8f3f97", "#7e0023"],
    );
    assert.deepEqual(
      EU_CATEGORIES.map((c) => c.color),
      ["#50f0e6", "#50ccaa", "#f0e641", "#ff5050", "#960032", "#7d2181"],
    );
  });

  it("every category keeps a distinct pattern, so colour is never the only cue", () => {
    for (const cats of [US_CATEGORIES, EU_CATEGORIES]) {
      assert.equal(new Set(cats.map((c) => c.pattern)).size, cats.length);
    }
  });
});

describe("theme tokens (WCAG AA)", () => {
  for (const [name, sel] of [
    ["light", ":root"],
    ["dark", ':root[data-theme="dark"]'],
  ] as const) {
    const t = tokens(sel);
    for (const fg of ["text", "muted", "danger"]) {
      for (const bg of ["bg", "surface", "surface-2"]) {
        it(`${name}: ${fg} on ${bg}`, () => {
          const ratio = contrast(t[fg], t[bg]);
          assert.ok(ratio >= AA_TEXT, `${t[fg]} on ${t[bg]} = ${ratio.toFixed(2)}:1`);
        });
      }
    }
    it(`${name}: danger-contrast on danger (alert badges)`, () => {
      assert.ok(contrast(t["danger-contrast"], t.danger) >= AA_TEXT);
    });
    it(`${name}: brand-contrast on brand (primary buttons)`, () => {
      assert.ok(contrast(t["brand-contrast"], t.brand) >= AA_TEXT);
    });
    it(`${name}: focus ring is at least 3:1 against the page`, () => {
      assert.ok(contrast(t.focus, t.bg) >= AA_NON_TEXT);
      assert.ok(contrast(t.focus, t.surface) >= AA_NON_TEXT);
    });
  }
});
