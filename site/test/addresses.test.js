// No page script names a file of this site by its site path ("/art/x.webp"): a release's files are
// served from the release's own folder (party-kit/build/folders.mjs), and only an address built
// beside the module (new URL("./x.webp", import.meta.url)) or from the folder's root (siteUrl, for
// a path the room sends) lands in it. Imports by site path are fine: the build rewrites those.
// A page's own address ("/lobby/?start") is fine too: pages stay where they are.
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildTree } from "../../scripts/build-public.mjs";
import { siteUrl } from "../site-path.js";

const OUT = mkdtempSync(join(tmpdir(), "party-addresses-"));
afterAll(() => rmSync(OUT, { recursive: true, force: true }));
const files = buildTree(OUT).map((f) => f.path);
const exists = (path) => statSync(join(OUT, path), { throwIfNoEntry: false })?.isFile() ?? false;
// The site's own top-level names, the release record's among them (the build writes it last).
const tops = [...new Set([...files.map((path) => path.split("/")[0]), "release.js"])];

/**
 * The string and template literals in `code` that start with one of the site's own top-level
 * names ("/lobby/...", "/site.css"), but for the imports. Comments are taken out first.
 */
function sitePaths(code) {
  const plain = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  const found = [];
  const names = tops.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  // A literal ends at its own kind of quote: a template may hold the other two (`/art/${a ? "" : ".webp"}`).
  const literal = new RegExp(["\"", "'", "`"].map((q) => `${q}(/(?:${names})(?:[/?#.][^${q}\\n]*)?)${q}`).join("|"), "g");
  for (const m of plain.matchAll(literal)) {
    const before = plain.slice(Math.max(0, m.index - 40), m.index);
    // An import, a re-export or an import(): the build rewrites those (rewriteSpecifiers).
    if (/(?:\bfrom|\bimport)\s*\(?\s*$/.test(before)) continue;
    found.push(m[1] ?? m[2] ?? m[3]);
  }
  return found;
}
/** Whether a site path is a page's address: a folder that holds an index.html, with or without a query. */
const isPage = (path) => {
  const folder = path.split(/[?#]/)[0];
  return folder.endsWith("/") && !folder.includes("${") && (folder === "/" || exists(`${folder.slice(1)}index.html`));
};

describe("the addresses the page scripts name", () => {
  it("finds a file named by site path, and tells it from an import and from a page's address", () => {
    expect(tops).toEqual(expect.arrayContaining(["lobby", "party", "art", "site.css", "release.js"]));
    const code = [
      'import { a } from "/lobby/dom.js";',
      'const m = await import("/party-kit/client/sounds.js");',
      'const CSS = "/party/games/x.css";',
      "img.src = `/lobby/rooms/${r.id}.webp`;",
      'const ART = (name) => `/art/${name}${/\\.\\w+$/.test(name) ? "" : ".webp"}`;',
      'const ART = "/party/games/paper-masks/art/";',
      'a.href = "/lobby/?start";',
      'fetch("/api/lobby/join/1234");',
      '// img.src = "/art/x.webp";',
    ].join("\n");
    expect(sitePaths(code)).toEqual(["/party/games/x.css", "/lobby/rooms/${r.id}.webp", '/art/${name}${/\\.\\w+$/.test(name) ? "" : ".webp"}', "/party/games/paper-masks/art/", "/lobby/?start"]);
    expect(isPage("/lobby/?start")).toBe(true);
    expect(isPage("/")).toBe(true);
    expect(isPage("/party/games/paper-masks/art/")).toBe(false);
    expect(isPage("/party/games/x.css")).toBe(false);
  });

  it("are never a file's site path: every file is named from the module itself, or through siteUrl", () => {
    const named = [];
    for (const path of files) {
      if (!/\.m?js$/.test(path) || path.includes("/vendor/")) continue;
      for (const literal of sitePaths(readFileSync(join(OUT, path), "utf8"))) if (!isPage(literal)) named.push(`${path}: ${literal}`);
    }
    expect(named).toEqual([]);
  });
});

describe("a site path the room sends (siteUrl)", () => {
  const root = new URL("https://party.example/r/0123456789ab/");

  it("is found under the folder the page's own files are served from", () => {
    expect(siteUrl("/cork-and-bell/game/party-view.js", root).href).toBe("https://party.example/r/0123456789ab/cork-and-bell/game/party-view.js");
    expect(siteUrl("party/games/who-am-i/door.svg", root).href).toBe("https://party.example/r/0123456789ab/party/games/who-am-i/door.svg");
    expect(siteUrl("/art/a.webp?x=1", new URL("https://party.example/")).href).toBe("https://party.example/art/a.webp?x=1");
  });

  it("never leaves the site: a path made to look like another host stays on this one, and a full address keeps its own origin for the caller to refuse", () => {
    expect(siteUrl("//evil.example/x.js", root).origin).toBe("https://party.example");
    expect(siteUrl("///evil.example/x.js", root).origin).toBe("https://party.example");
    expect(siteUrl("https://evil.example/x.js", root).origin).toBe("https://evil.example");
    expect(siteUrl("/\\evil.example/x.js", root).origin).toBe("https://party.example");
  });
});
