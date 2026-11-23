// The build's reading of which modules a page loads (party-kit/build/public.mjs, moduleGraph and
// roomMakingPages): small made-up sites, including the cases a regular expression got wrong.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BOT_CHECK_MODULE, moduleGraph, roomMakingPages } from "../build/public.mjs";

let out;
afterEach(() => out && rmSync(out, { recursive: true, force: true }));

/** A site in a fresh folder: the kit's bot check, plus `files` (site path -> text). */
function site(files) {
  out = mkdtempSync(join(tmpdir(), "module-graph-"));
  for (const [path, text] of Object.entries({ [BOT_CHECK_MODULE]: "export const botCheck = 1;\n", ...files })) {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), text);
  }
  return out;
}
const page = (main) => ({ "p/index.html": '<!doctype html><script type="module" src="main.js"></script>', "p/main.js": main });
const reaches = (dir, options) => moduleGraph(dir, join(dir, "p/index.html"), options).includes(join(dir, BOT_CHECK_MODULE));

describe("reading what a page loads", () => {
  it("(a) finds an import after a string holding /* and before a later */ comment", () => {
    expect(reaches(site(page('const GLOB = "/rooms/*";\nimport("/party-kit/client/bot-check.js");\n/** done */\n')))).toBe(true);
  });

  it("(b) finds a static import after a regular expression holding \\/*", () => {
    expect(reaches(site(page('const re = /a\\/*b/;\nimport { botCheck } from "/party-kit/client/bot-check.js";\n/** x */\n')))).toBe(true);
  });

  it("(c) finds import() of a template literal with no substitution", () => {
    expect(reaches(site(page("import(`/party-kit/client/bot-check.js`);\n")))).toBe(true);
  });

  it("follows re-exports, export *, relative paths, inline module scripts and the page's import map", () => {
    expect(reaches(site(page('export { botCheck } from "/party-kit/client/bot-check.js";\n')))).toBe(true);
    expect(reaches(site({ ...page('export * from "./lib.js";\n'), "p/lib.js": 'import "../party-kit/client/bot-check.js";\n' }))).toBe(true);
    expect(reaches(site({ "p/index.html": '<script type="module">import "/party-kit/client/bot-check.js"</script>' }))).toBe(true);
    const mapped = {
      "p/index.html": '<script type="importmap">{ "imports": { "kit/": "/party-kit/client/" } }</script><script type="module" src="main.js"></script>',
      "p/main.js": 'import { botCheck } from "kit/bot-check.js";\n',
    };
    expect(reaches(site(mapped))).toBe(true);
  });

  it("never takes an import named in a comment or a string for one", () => {
    expect(reaches(site(page('// import "/party-kit/client/bot-check.js";\n/* import("/party-kit/client/bot-check.js") */\nconst s = \'import "/party-kit/client/bot-check.js"\';\n')))).toBe(false);
  });

  it("cannot tell what a computed import() loads: it fails, naming the file, unless the file is on the allow list", () => {
    for (const main of ['const m = "bot-check"; import("/party-kit/client/" + m + ".js");\n', "const m = 'bot-check'; import(`/party-kit/client/${m}.js`);\n"]) {
      const dir = site(page(main));
      expect(() => reaches(dir), main).toThrow(/Cannot tell what p\/main\.js loads with import\(\)/);
      expect(() => roomMakingPages(dir)).toThrow(/p\/main\.js/);
      // On the list it is known, and not followed.
      expect(reaches(dir, { computedImports: ["p/main.js"] })).toBe(false);
    }
  });

  it("starts from a module as well as a page", () => {
    const dir = site({ "v/view.js": 'import "/party-kit/client/bot-check.js";\n' });
    expect(moduleGraph(dir, join(dir, "v/view.js")).includes(join(dir, BOT_CHECK_MODULE))).toBe(true);
  });
});
