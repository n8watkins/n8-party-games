// The pre-deploy gate (.github/scripts/predeploy.mjs) runs every end-to-end suite a deploy must
// pass, the Table's among them, each against a Worker of its own when they run side by side.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STEPS, stepPort } from "../../.github/scripts/predeploy-steps.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const scripts = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).scripts;

describe("the pre-deploy gate's steps", () => {
  it("include the room, the party room, Cork & Bell, Hot Potato, the Table's suites, Paper Masks, the front page's, Tin Derby's, the robot's and slime's moves, the characters' counters, Who Am I?'s, Cork & Bell's switches and a new build's", () => {
    expect(STEPS.map(([, script]) => script)).toEqual(["test:room", "test:lobby", "test:cork", "test:hot-potato", "test:hearing", "test:mode", "test:two-rooms", "test:table", "test:paper-masks", "test:home", "test:tin-derby", "test:moves", "test:counters", "test:who-am-i", "test:cork:switches", "test:release"]);
  });

  it("run Cork & Bell's test switches against a Worker of their own with the production settings, and every other step on the local ones", () => {
    const own = STEPS.filter(([, , options]) => options?.env !== undefined).map(([, script, { env }]) => [script, env]);
    expect(own).toEqual([["test:cork:switches", ""]]);
  });

  it("let only test:release run a Worker of its own, which it restarts for each deploy, on a port the gate gives it", () => {
    expect(STEPS.filter(([, , options]) => options?.own).map(([, script]) => script)).toEqual(["test:release"]);
    const source = readFileSync(resolve(ROOT, "lobby/test/e2e-release.mjs"), "utf8");
    expect(source).toMatch(/opt\("port",/);
    // Its builds go to a folder of its own, never dist/public, which the gate's other Workers serve.
    expect(source).toMatch(/--out=\$\{dir\}/);
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line))
      .join("\n");
    expect(code).not.toMatch(/dist[/\\]public|landing[/\\]public/);
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
    expect(ports).toEqual([8853, 8855, 8856, 8857, 8858, 8859, 8860, 8861, 8862, 8863, 8864, 8865, 8866, 8867, 8868, 8869]);
  });
});
