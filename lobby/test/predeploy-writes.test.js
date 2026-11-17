// No suite in the pre-deploy gate may write inside a folder the local build watches
// (wrangler.jsonc, build.watch_dir). Every Worker the gate starts rebuilds dist/public, which they
// all serve, when a watched file changes: a still saved there mid-run pulls the files out from
// under the other suites, and they fail on pages that stop loading.
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STEPS } from "../../.github/scripts/predeploy-steps.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const scripts = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).scripts;

/** Every folder or file any of wrangler.jsonc's builds watches, as absolute paths. */
function watched(text = readFileSync(resolve(ROOT, "wrangler.jsonc"), "utf8")) {
  const dirs = new Set();
  for (const [, list] of text.matchAll(/"watch_dir"\s*:\s*\[([^\]]*)\]/g)) for (const [, dir] of list.matchAll(/"([^"]+)"/g)) dirs.add(resolve(ROOT, dir));
  return [...dirs];
}

/** Where a suite's script saves its files when the gate runs it with no options: its --out or --shots defaults. */
function writesTo(source) {
  return [...source.matchAll(/\b(?:opt|arg)\(\s*["'](?:out|shots)["']\s*,\s*["']([^"']+)["']/g)].map(([, path]) => resolve(ROOT, path));
}

/** Whether a suite's script saves anything at all (stills, logs, files). */
const saves = (source) => /\b(?:mkdirSync|writeFileSync|writeFile|appendFileSync)\(|\.screenshot\(/.test(source);

/** Whether `path` is `dir` or anywhere under it. */
function inside(path, dir) {
  const rel = relative(dir, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

describe("the pre-deploy gate's suites", () => {
  it("know where the local build looks for changes", () => {
    const dirs = watched();
    expect(dirs).toContain(resolve(ROOT, "site"));
    expect(dirs).toContain(resolve(ROOT, "lobby/public"));
  });

  it("each save their files outside every watched folder", () => {
    const dirs = watched();
    for (const [, script] of STEPS) {
      const file = scripts[script].replace(/^node\s+/, "").split(/\s+/)[0];
      const source = readFileSync(resolve(ROOT, file), "utf8");
      const targets = writesTo(source);
      // A suite that saves something must say where through --out or --shots, so this test can see it.
      if (saves(source)) expect(targets.length, `${script} saves files but has no --out or --shots default`).toBeGreaterThan(0);
      for (const target of targets) {
        const hit = dirs.find((dir) => inside(target, dir));
        expect(hit, `${script} saves into ${relative(ROOT, target) || target}, which the build watches`).toBeUndefined();
      }
    }
  });

  it("would catch a suite saving inside a watched folder", () => {
    const dirs = watched();
    const [target] = writesTo('const out = resolve(opt("out", "site/test/shots"));');
    expect(dirs.some((dir) => inside(target, dir))).toBe(true);
    const [outside] = writesTo('const SHOTS = arg("shots", "/tmp/claude-hot-potato/shots");');
    expect(dirs.some((dir) => inside(outside, dir))).toBe(false);
  });
});
