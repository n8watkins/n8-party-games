// Hot Potato's colours against WCAG contrast, read from public/style.css itself: the words on every
// heat's ground at the pink pulse's brightest, and the lost-life outlines.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
const token = (name) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\\b`, "i"))[1];
const hex = (h) => {
  const full = h.length === 4 ? `#${[...h.slice(1)].map((c) => c + c).join("")}` : h;
  return [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const lum = (c) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** A layer's two grounds (the band and the rest), from its linear-gradient. */
const ground = (sel) => {
  const rule = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.]/g, "\\.")}\\s*\\{[^}]*linear-gradient\\(112deg,\\s*(#[0-9a-f]{6})[^,]*,\\s*(#[0-9a-f]{6})`, "i"));
  return [hex(rule[1]), hex(rule[2])];
};
const pulseTo = (heat) => Number(css.match(new RegExp(`data-heat="${heat}"\\] \\.l-pulse \\{ --to: ([\\d.]+)`))[1]);
const strainCrit = Number(css.match(/data-heat="strain"\] \.l-crit \{ opacity: ([\d.]+)/)[1]);

const PINK = hex(token("pink"));
const hot = ground(".ground .l-hot");
const crit = ground(".ground .l-crit");
const HEATS = {
  calm: ground(".ground"),
  warm: ground(".ground .l-warm"),
  hot,
  strain: [0, 1].map((i) => mix(mix(hot[i], crit[i], strainCrit), PINK, pulseTo("strain"))),
  critical: [0, 1].map((i) => mix(crit[i], PINK, pulseTo("critical"))),
};

describe("contrast on every heat's ground, at the pulse's brightest", () => {
  for (const [heat, grounds] of Object.entries(HEATS)) {
    it(`${heat}: words at 4.5:1, lost lives' outlines at 3:1`, () => {
      for (const g of grounds) {
        for (const name of ["y", "bad", "good", "soft", "white"]) expect(ratio(hex(token(name)), g), `${name} on ${heat}`).toBeGreaterThanOrEqual(4.5);
        // A lost life is an empty outline in --soft (style.css .life i).
        expect(css).toMatch(/\.life i \{[^}]*border: 2px solid var\(--soft\)/);
        expect(ratio(hex(token("soft")), g)).toBeGreaterThanOrEqual(3);
      }
    });
  }
});
