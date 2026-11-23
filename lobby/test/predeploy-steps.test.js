// The pre-deploy gate (.github/scripts/predeploy.mjs) runs every end-to-end suite a deploy must
// pass, the Table's among them, each against a Worker of its own when they run side by side.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STEPS, releaseIdIn, releaseMismatch, stepPort } from "../../.github/scripts/predeploy-steps.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const scripts = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).scripts;

describe("the pre-deploy gate's steps", () => {
  it("include the room, the party room, Cork & Bell, Hot Potato, the Table's suites, Paper Masks, the front page's, Tin Derby's, the robot's and slime's moves, Who Am I?'s, Cork & Bell's switches and a new build's", () => {
    expect(STEPS.map(([, script]) => script)).toEqual(["test:room", "test:lobby", "test:cork", "test:hot-potato", "test:hearing", "test:mode", "test:two-rooms", "test:table", "test:paper-masks", "test:home", "test:tin-derby", "test:moves", "test:who-am-i", "test:cork:switches", "test:release"]);
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
    expect(ports).toEqual([8853, 8855, 8856, 8857, 8858, 8859, 8860, 8861, 8862, 8863, 8864, 8865, 8866, 8867, 8868]);
  });
});

describe("the gate's check that its local Workers and their pages name one build", () => {
  const A = "4af2ff5586e4";
  const B = "e0453eb6247d";

  it("passes when every Worker names the build in the shared release.js", () => {
    expect(releaseMismatch([{ base: "http://localhost:8853", release: A }, { base: "http://localhost:8867", release: A }], A)).toBeNull();
  });

  it("fails, naming each Worker that does not, as after #88 (a local and a production-settings build of one tree)", () => {
    const problem = releaseMismatch([{ base: "http://localhost:8853", release: B }, { base: "http://localhost:8867", release: A }], A);
    expect(problem).toMatch(/do not all name the build their pages load \(dist\/public\/release\.js: 4af2ff5586e4\)/);
    expect(problem).toContain("http://localhost:8853 says e0453eb6247d");
    expect(problem).not.toContain("8867");
  });

  it("fails when a Worker gives no answer, or the shared release.js names no build", () => {
    expect(releaseMismatch([{ base: "http://localhost:8853", release: null }], A)).toContain("says nothing");
    expect(releaseMismatch([{ base: "http://localhost:8853", release: A }], null)).toMatch(/names no release id/);
  });

  it("reads the id from a release.js module as the build writes it", () => {
    expect(releaseIdIn(`export const RELEASE = Object.freeze({"id":"${A}","site":"0.1.0"});`)).toBe(A);
    expect(releaseIdIn("export const RELEASE = {};")).toBeNull();
    expect(releaseIdIn(null)).toBeNull();
  });
});
