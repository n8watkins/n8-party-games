// The pre-deploy gate (.github/scripts/predeploy.mjs) runs every end-to-end suite a deploy must
// pass, the Table's among them, each against a Worker of its own when they run side by side.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STEPS, stepPort } from "../../.github/scripts/predeploy-steps.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const scripts = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).scripts;

describe("the pre-deploy gate's steps", () => {
  it("include the room, the party room, Cork & Bell, Hot Potato, the Table's suites and the front page's", () => {
    expect(STEPS.map(([, script]) => script)).toEqual(["test:room", "test:lobby", "test:cork", "test:hot-potato", "test:hearing", "test:mode", "test:two-rooms", "test:table", "test:home"]);
  });

  it("are each an npm script that exists, named in its own label", () => {
    for (const [name, script] of STEPS) {
      expect(scripts[script], script).toBeDefined();
      expect(name).toContain(`(${script})`);
    }
  });

  it("each get a port of their own side by side, with test:cork alone on its server", () => {
    const ports = STEPS.map((_, i) => stepPort(8853, i));
    expect(new Set(ports).size).toBe(STEPS.length);
    expect(ports).toEqual([8853, 8855, 8856, 8857, 8858, 8859, 8860, 8861, 8862]);
  });
});
