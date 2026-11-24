// Release folders (party-kit/build/folders.mjs): a built public folder laid out so that a
// returning browser asks for almost nothing. Code under /r/<release id>/, media under
// /m/<hash of its bytes>.<ext>, both kept for a year; the pages at their own addresses, always
// asked for again, pointing only into their own release's folder.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { headersFile } from "../build/public.mjs";
import {
  BIG_JSON_BYTES,
  IMMUTABLE,
  IMMUTABLE_PATHS,
  MAX_STATIC_REDIRECTS,
  PAGE_MIRROR,
  carriedFrom,
  foldTree,
  isMedia,
  layoutOf,
  mediaPath,
  redirectsFile,
  rewriteCss,
  rewriteHtml,
  rewriteSpecifiers,
  withCarried,
  writePlan,
} from "../build/folders.mjs";

const ID = "0123456789ab";
const made = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
/** A folder holding `files` ({path: text or bytes}); returns its path. */
function folder(files) {
  const dir = mkdtempSync(join(tmpdir(), "party-folders-"));
  made.push(dir);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}
const hashOf = (body) => createHash("sha256").update(body).digest("hex").slice(0, 20);
/** A plan's files by site path, as text. */
const textOf = (plan) => Object.fromEntries(plan.files.map((f) => [f.path, f.data !== undefined ? f.data.toString() : readFileSync(f.from, "utf8")]));

describe("the headers of a site with release folders (headersFile)", () => {
  const rulesOf = (text) => text.split(/\n(?=\/)/).map((rule) => rule.trimEnd().split("\n"));

  it("keeps a listed path for a year, and nothing else: no page and no other file gets a cache rule", () => {
    const text = headersFile([], { immutable: IMMUTABLE_PATHS });
    const rules = rulesOf(text);
    expect(IMMUTABLE).toBe("public, max-age=31536000, immutable");
    expect(rules.filter((r) => r.some((line) => /Cache-Control/i.test(line)))).toEqual([
      ["/r/*", `  Cache-Control: ${IMMUTABLE}`],
      ["/m/*", `  Cache-Control: ${IMMUTABLE}`],
    ]);
    // Without the option nothing changes for a site that has no such folders.
    expect(headersFile([])).not.toMatch(/Cache-Control/i);
  });

  it("takes only a plain folder path to keep, so no page address can be kept by mistake", () => {
    for (const bad of ["/*", "/", "r/*", "/r/", "/r/*\n  X: y", "/lobby/index.html"]) expect(() => headersFile([], { immutable: [bad] }), bad).toThrow(/immutable/);
  });

  it("gives a page's copy in a release folder the very rules of the page itself", () => {
    const opts = { frames: "self", microphone: ["/potato/*"], images: { "/party/*": ["https://pics.example"] }, botCheck: ["/lobby/*"] };
    const plain = rulesOf(headersFile(["'sha256-x'"], opts));
    const mirrored = rulesOf(headersFile(["'sha256-x'"], { ...opts, mirrors: [PAGE_MIRROR] }));
    expect(PAGE_MIRROR).toBe("/r/:release");
    const own = plain.filter(([path]) => path !== "/*");
    expect(own.map(([path]) => path)).toEqual(["/potato/*", "/party/*", "/lobby/*"]);
    // Every rule as before, then each page rule again under the folder, with the same lines.
    expect(mirrored.slice(0, plain.length)).toEqual(plain);
    expect(mirrored.slice(plain.length)).toEqual(own.map(([path, ...lines]) => [`/r/:release${path}`, ...lines]));
    // The site-wide rule is not repeated: it already covers the folder.
    expect(mirrored.filter(([path]) => path.endsWith("/*") && path.replace("/r/:release", "") === "/*")).toHaveLength(1);
  });

  it("stays within what Workers reads: at most 100 rules, lines under 2,000 characters", () => {
    const text = headersFile(["'sha256-x'"], { frames: "self", microphone: ["/a/*", "/b/*"], botCheck: ["/c/*", "/d/*", "/e/*"], images: { "/f/*": ["https://pics.example"] }, immutable: IMMUTABLE_PATHS, mirrors: [PAGE_MIRROR] });
    expect(rulesOf(text).length).toBeLessThanOrEqual(100);
    for (const line of text.split("\n")) expect(line.length).toBeLessThan(2000);
  });
});

describe("what counts as media (isMedia)", () => {
  it("is pictures, sound, fonts, models and big data; code, styles, pages and small data are not", () => {
    for (const path of ["a.webp", "a.PNG", "x/a.jpg", "a.svg", "a.mp3", "a.woff2", "a.ttf", "a.glb", "a.hdr"]) expect(isMedia(path, 10), path).toBe(true);
    for (const path of ["a.js", "a.mjs", "a.css", "a.html", "a.txt", "LICENSE", "a.webmanifest"]) expect(isMedia(path, 10_000_000), path).toBe(false);
    expect(isMedia("plate.json", BIG_JSON_BYTES - 1)).toBe(false);
    expect(isMedia("cities.json", BIG_JSON_BYTES)).toBe(true);
  });

  it("leaves a model that names other files beside it (.gltf) in the folder, where those names still resolve", () => {
    expect(isMedia("set.gltf", 10_000_000)).toBe(false);
  });

  it("names a media file by its bytes: the same bytes are one address, other bytes another, the extension kept", () => {
    expect(mediaPath(Buffer.from("pic"), "art/A.WEBP")).toBe(`m/${hashOf("pic")}.webp`);
    expect(mediaPath(Buffer.from("pic"), "other/b.webp")).toBe(mediaPath(Buffer.from("pic"), "art/a.webp"));
    expect(mediaPath(Buffer.from("pic2"), "art/a.webp")).not.toBe(mediaPath(Buffer.from("pic"), "art/a.webp"));
  });
});

describe("a page's addresses (rewriteHtml)", () => {
  const address = { "lobby/main.js": "/r/ID/lobby/main.js", "lobby/lobby.css": "/r/ID/lobby/lobby.css", "site.css": "/r/ID/site.css", "art/a.webp": "/m/aaaa.webp", "icons/i.png": "/m/iiii.png", "game/vendor/three.module.js": "/r/ID/game/vendor/three.module.js", "game/vendor/addons/": "/r/ID/game/vendor/addons/" };
  const to = (from, ref) => {
    const path = ref.startsWith("/") ? ref.slice(1) : join(dirname(from), ref).replace(/^\.\//, "");
    return address[path] ?? null;
  };
  const html = (text, from = "lobby/index.html") => rewriteHtml(text, (ref) => to(from, ref));

  it("points scripts, styles, pictures and preloads at where the file now is, relative or not", () => {
    expect(html(`<link rel="stylesheet" href="lobby.css" />\n<script type="module" src="main.js"></script>`)).toBe(`<link rel="stylesheet" href="/r/ID/lobby/lobby.css" />\n<script type="module" src="/r/ID/lobby/main.js"></script>`);
    expect(html(`<link rel='stylesheet' href='/site.css'><img class="x" src="/art/a.webp" alt="a > b">`)).toBe(`<link rel='stylesheet' href='/r/ID/site.css'><img class="x" src="/m/aaaa.webp" alt="a > b">`);
    expect(html(`<link rel="icon" href="/icons/i.png" />`)).toBe(`<link rel="icon" href="/m/iiii.png" />`);
  });

  it("leaves links to pages, addresses it is not given, outside addresses and data alone", () => {
    const same = [`<a href="/lobby/?start">Start</a>`, `<a class="logo" href="/">home</a>`, `<link rel="manifest" href="/manifest.webmanifest" />`, `<link rel="icon" href="data:," />`, `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>`, `<img src="//cdn.example/a.png">`, `<form action="/api/x"></form>`];
    for (const text of same) expect(html(text), text).toBe(text);
  });

  it("keeps a query or a fragment on the address", () => {
    expect(html(`<script type="module" src="main.js?x=1#y"></script>`)).toBe(`<script type="module" src="/r/ID/lobby/main.js?x=1#y"></script>`);
  });

  it("rewrites an import map's addresses, files and folders, and keeps its names", () => {
    const map = `<script type="importmap">\n  { "imports": { "three": "./vendor/three.module.js", "three/addons/": "./vendor/addons/", "x": "https://cdn.example/x.js" } }\n</script>`;
    const out = html(map, "game/index.html");
    const json = JSON.parse(/<script type="importmap">([\s\S]*)<\/script>/.exec(out)[1]);
    expect(json).toEqual({ imports: { three: "/r/ID/game/vendor/three.module.js", "three/addons/": "/r/ID/game/vendor/addons/", x: "https://cdn.example/x.js" } });
  });

  it("refuses what it cannot rewrite, so nothing is left pointing at an address that is gone", () => {
    expect(() => html(`<img srcset="/art/a.webp 2x">`)).toThrow(/srcset/);
    expect(() => html(`<script type="module">import "/lobby/main.js";</script>`)).toThrow(/inline module/);
    expect(() => html(`<style>body { background: url(/art/a.webp) }</style>`)).toThrow(/<style>/);
  });
});

describe("a stylesheet's addresses (rewriteCss)", () => {
  const css = (text) => rewriteCss(text, (ref) => ({ "fonts/a.woff2": "/m/ffff.woff2", "/fonts/a.woff2": "/m/ffff.woff2", "art/b.webp": "/m/bbbb.webp", "other.css": "/r/ID/x/other.css" })[ref] ?? null);

  it("points url() at where the file now is, with or without quotes, and keeps the rest", () => {
    expect(css(`@font-face { src: url("/fonts/a.woff2") format("woff2"); }`)).toBe(`@font-face { src: url("/m/ffff.woff2") format("woff2"); }`);
    expect(css(`a { background: url(art/b.webp), url( 'fonts/a.woff2' ) }`)).toBe(`a { background: url(/m/bbbb.webp), url( '/m/ffff.woff2' ) }`);
    expect(css(`@import url("other.css");`)).toBe(`@import url("/r/ID/x/other.css");`);
  });

  it("leaves data, outside addresses and unknown files alone", () => {
    const same = `a { background: url(data:image/png;base64,AAAA), url("https://x.example/a.png"), url(nope.png) }`;
    expect(css(same)).toBe(same);
  });

  it("refuses an @import by site path, which it does not rewrite", () => {
    expect(() => css(`@import "/site.css";`)).toThrow(/@import/);
  });
});

describe("a module's imports (rewriteSpecifiers)", () => {
  const files = new Set(["release.js", "party-kit/client/sounds.js", "lobby/main.js", "lobby/shared/world.js", "lobby/look3d/room3d.js"]);
  const js = (code, from = "lobby/look3d/room3d.js") => rewriteSpecifiers(code, from, (path) => files.has(path));

  it("turns an import by site path into the same file by relative path, static, re-exported or dynamic", () => {
    expect(js(`import { RELEASE } from "/release.js";`)).toBe(`import { RELEASE } from "../../release.js";`);
    expect(js(`export * from '/lobby/shared/world.js';`)).toBe(`export * from '../shared/world.js';`);
    expect(js(`const m = await import("/party-kit/client/sounds.js");`)).toBe(`const m = await import("../../party-kit/client/sounds.js");`);
    expect(js(`import "/lobby/main.js";`, "release-switch.js")).toBe(`import "./lobby/main.js";`);
    expect(js(`import x from "/lobby/main.js?v=1";`, "lobby/a.js")).toBe(`import x from "./main.js?v=1";`);
  });

  it("leaves relative and bare imports, computed ones, strings and comments alone", () => {
    const same = [
      `import a from "./a.js";`,
      `import * as THREE from "three";`,
      `const view = await import(address.href);`,
      `const text = 'import x from "/release.js"';`,
      `// import x from "/release.js";`,
      `const path = "/lobby/main.js";`,
      `import gone from "/not/a/file.js";`,
      `import x from "//cdn.example/x.js";`,
    ].join("\n");
    expect(js(same)).toBe(same);
  });

  it("rewrites every one in a file, whatever their order and length", () => {
    const code = `import a from "/release.js";\nimport b from "/lobby/shared/world.js";\nexport { c } from "/party-kit/client/sounds.js";\n`;
    expect(js(code, "lobby/main.js")).toBe(`import a from "../release.js";\nimport b from "./shared/world.js";\nexport { c } from "../party-kit/client/sounds.js";\n`);
  });
});

describe("a site folded into release folders (foldTree)", () => {
  const big = JSON.stringify({ words: "x".repeat(BIG_JSON_BYTES) });
  const site = {
    "index.html": `<link rel="icon" href="/icons/icon.png"><link rel="manifest" href="/manifest.webmanifest"><link rel="stylesheet" href="/site.css"><script type="module" src="/home.js"></script><img src="/art/a.webp"><a href="/lobby/">go</a>`,
    "home.js": `import { RELEASE } from "/release.js";\nexport const art = new URL("./art/a.webp", import.meta.url);`,
    "release.js": "export const RELEASE = {};",
    "site.css": `@font-face { src: url("/fonts/f.woff2"); } body { background: url(art/a.webp) }`,
    "manifest.webmanifest": `{"icons":[{"src":"/icons/icon.png"}]}`,
    "icons/icon.png": "icon",
    "art/a.webp": "pic",
    "art/same.webp": "pic",
    "fonts/f.woff2": "font",
    "lobby/index.html": `<link rel="stylesheet" href="lobby.css"><script type="module" src="main.js"></script>`,
    "lobby/main.js": `import "/home.js";\nconst look = () => import("./look3d/room3d.js");`,
    "lobby/lobby.css": `a { background: url("../art/a.webp") }`,
    "lobby/look3d/room3d.js": `export const sound = new URL("../sounds/hop.mp3", import.meta.url);`,
    "lobby/sounds/hop.mp3": "hop",
    "lobby/plate.json": `{"small":true}`,
    "potato/cities.json": big,
    "game/index.html": `<script type="importmap">{"imports":{"three":"./vendor/three.module.js"}}</script><script type="module" src="game/main.js"></script>`,
    "game/vendor/three.module.js": "export {};",
    "game/game/main.js": `fetch("game/baked/set.glb");`,
    "game/game/baked/set.glb": "glb",
    "_headers": "/*\n  X: flat",
  };
  const tree = folder(site);
  const headers = ({ scripts }) => `/*\n  X: ${scripts.join(" ")}\n`;
  const fold = (extra = {}) => foldTree({ tree, files: Object.keys(site), id: ID, stable: ["manifest.webmanifest", "icons"], stableMedia: ["game/game/baked"], headers, ...extra });
  const plan = fold();
  const text = textOf(plan);
  const media = (body, ext) => `m/${hashOf(body)}.${ext}`;

  it("puts every file that is not media in the release's folder, media under its hash, and the pages at their own addresses too", () => {
    expect(Object.keys(text).sort()).toEqual(
      [
        "_headers",
        // The pages, where they always were.
        "index.html",
        "lobby/index.html",
        "game/index.html",
        // Kept at their own address as well: an installed site reads its manifest and icons there.
        "manifest.webmanifest",
        "icons/icon.png",
        // The folder: every file that is not media, the pages included (a game's page in a frame loads from it).
        ...["index.html", "home.js", "release.js", "site.css", "manifest.webmanifest", "lobby/index.html", "lobby/main.js", "lobby/lobby.css", "lobby/look3d/room3d.js", "lobby/plate.json", "game/index.html", "game/vendor/three.module.js", "game/game/main.js"].map((p) => `r/${ID}/${p}`),
        // Media, once per content: two files with the same bytes are one.
        media("icon", "png"),
        media("pic", "webp"),
        media("font", "woff2"),
        media("hop", "mp3"),
        media(big, "json"),
        media("glb", "glb"),
      ].sort(),
    );
  });

  it("makes each page point only into its own release's folder and at media, the copy in the folder the same", () => {
    expect(text["index.html"]).toBe(
      `<link rel="icon" href="/${media("icon", "png")}"><link rel="manifest" href="/manifest.webmanifest"><link rel="stylesheet" href="/r/${ID}/site.css"><script type="module" src="/r/${ID}/home.js"></script><img src="/${media("pic", "webp")}"><a href="/lobby/">go</a>`,
    );
    expect(text["lobby/index.html"]).toBe(`<link rel="stylesheet" href="/r/${ID}/lobby/lobby.css"><script type="module" src="/r/${ID}/lobby/main.js"></script>`);
    expect(JSON.parse(/importmap">(.*?)<\/script>/.exec(text["game/index.html"])[1])).toEqual({ imports: { three: `/r/${ID}/game/vendor/three.module.js` } });
    for (const page of ["index.html", "lobby/index.html", "game/index.html"]) expect(text[`r/${ID}/${page}`]).toBe(text[page]);
    // Nothing a page loads is left at an address outside the folder and the media.
    for (const page of ["index.html", "lobby/index.html", "game/index.html"]) {
      const loaded = [...text[page].matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((ref) => !["/lobby/", "/manifest.webmanifest"].includes(ref));
      for (const ref of loaded) expect(ref, page).toMatch(new RegExp(`^/(r/${ID}|m)/`));
    }
  });

  it("makes modules import each other by relative path, so every import stays in the folder", () => {
    expect(text[`r/${ID}/home.js`]).toBe(`import { RELEASE } from "./release.js";\nexport const art = new URL("./art/a.webp", import.meta.url);`);
    expect(text[`r/${ID}/lobby/main.js`]).toBe(`import "../home.js";\nconst look = () => import("./look3d/room3d.js");`);
  });

  it("points a stylesheet straight at media", () => {
    expect(text[`r/${ID}/site.css`]).toBe(`@font-face { src: url("/${media("font", "woff2")}"); } body { background: url(/${media("pic", "webp")}) }`);
    expect(text[`r/${ID}/lobby/lobby.css`]).toBe(`a { background: url("/${media("pic", "webp")}") }`);
  });

  it("sends an address a module builds beside itself on to the media, for good; and a listed one at its old address, for now", () => {
    const moved = plan.redirects.filter((r) => r.status === 301);
    expect(moved).toEqual(
      expect.arrayContaining([
        { from: `/r/${ID}/art/a.webp`, to: `/${media("pic", "webp")}`, status: 301 },
        { from: `/r/${ID}/art/same.webp`, to: `/${media("pic", "webp")}`, status: 301 },
        { from: `/r/${ID}/lobby/sounds/hop.mp3`, to: `/${media("hop", "mp3")}`, status: 301 },
        { from: `/r/${ID}/potato/cities.json`, to: `/${media(big, "json")}`, status: 301 },
        { from: `/r/${ID}/game/game/baked/set.glb`, to: `/${media("glb", "glb")}`, status: 301 },
      ]),
    );
    // One for every media file, each from inside the folder.
    expect(moved).toHaveLength(7);
    for (const r of moved) expect(r.from.startsWith(`/r/${ID}/`)).toBe(true);
    // A page that still asks by the old address (a game's own page that names its files from the
    // page, not from the module) is sent on each time: never kept, so a new release can change it.
    expect(plan.redirects.filter((r) => r.status === 302)).toEqual([{ from: "/game/game/baked/set.glb", to: `/${media("glb", "glb")}`, status: 302 }]);
  });

  it("writes the headers from the pages as they are served, and drops the flat tree's own", () => {
    // The import map's text changed with the folder, so its hash did.
    const map = /importmap">(.*?)<\/script>/.exec(text["game/index.html"])[1];
    expect(text["_headers"]).toBe(`/*\n  X: 'sha256-${createHash("sha256").update(map).digest("base64")}'\n`);
  });

  it("is the same plan for the same tree, and another folder for another id, with the same media", () => {
    expect(textOf(fold())).toEqual(text);
    const other = fold({ id: "ba9876543210" });
    const paths = other.files.map((f) => f.path);
    expect(paths.filter((p) => p.startsWith("m/")).sort()).toEqual(plan.files.map((f) => f.path).filter((p) => p.startsWith("m/")).sort());
    expect(paths.some((p) => p.startsWith(`r/${ID}/`))).toBe(false);
    expect(paths.filter((p) => p.startsWith("r/ba9876543210/"))).toHaveLength(13);
  });

  it("refuses a tree that already has a folder where the releases or the media go, and a file name an address cannot hold", () => {
    expect(() => foldTree({ tree, files: [...Object.keys(site), "r/x.js"], id: ID, headers })).toThrow(/r\/x\.js/);
    expect(() => foldTree({ tree, files: [...Object.keys(site), "m/x.js"], id: ID, headers })).toThrow(/m\/x\.js/);
    expect(() => foldTree({ tree, files: [...Object.keys(site), "art/my pic.webp"], id: ID, headers })).toThrow(/my pic/);
  });

  it("writes the redirects as Workers reads them, the lasting ones and the passing ones, and refuses more than it takes", () => {
    const [note, ...lines] = redirectsFile(plan.redirects).trimEnd().split("\n");
    expect(note).toMatch(/^# /);
    expect(lines).toContain(`/r/${ID}/lobby/sounds/hop.mp3 /${media("hop", "mp3")} 301`);
    expect(lines).toContain(`/game/game/baked/set.glb /${media("glb", "glb")} 302`);
    expect(lines).toHaveLength(8);
    for (const line of lines) expect(line).toMatch(/^\/\S+ \/m\/\S+ 30[12]$/);
    expect(MAX_STATIC_REDIRECTS).toBe(2000);
    const many = Array.from({ length: MAX_STATIC_REDIRECTS + 1 }, (_, i) => ({ from: `/r/${ID}/a${i}.webp`, to: "/m/a.webp", status: 301 }));
    expect(() => redirectsFile(many)).toThrow(/2,?000/);
  });

  describe("written to a folder, with the releases before it carried", () => {
    // The release before: folded too, with a sound it had and this one has not, and other code.
    const before = { ...site, "lobby/main.js": `import "/home.js"; // before`, "lobby/sounds/old.mp3": "old", "lobby/gone.js": "export {};" };
    const beforeTree = folder(before);
    const OLD = "aaaaaaaaaaaa";
    const beforeOut = folder({});
    writePlan(beforeOut, foldTree({ tree: beforeTree, files: Object.keys(before), id: OLD, stable: ["manifest.webmanifest", "icons"], headers }));
    // The release before that: from before there were folders, every file at its own address.
    const flat = { "index.html": "<p>old page</p>", "release.js": "old record", "lobby/index.html": "<p>old lobby</p>", "lobby/main.js": "// flat main", "lobby/look3d/room3d.js": "// flat look", "lobby/sounds/hop.mp3": "flat hop", "icons/icon.png": "old icon", "game/game/baked/set.glb": "old glb", "_headers": "/*\n  X: flat" };
    const flatOut = folder(flat);

    const out = folder({ "stale.txt": "left from the build before" });
    const carried = [carriedFrom(beforeOut, OLD), carriedFrom(flatOut, "bbbbbbbbbbbb")];
    const whole = withCarried(plan, carried);
    const written = writePlan(out, whole);
    const read = (path) => readFileSync(join(out, path), "utf8");

    it("tells a folded build from one made before there were folders", () => {
      expect(layoutOf(beforeOut, OLD)).toBe("folders");
      expect(layoutOf(flatOut, "bbbbbbbbbbbb")).toBe("flat");
      expect(carried.map((c) => [c.id, c.layout])).toEqual([[OLD, "folders"], ["bbbbbbbbbbbb", "flat"]]);
    });

    it("empties the folder first, and lists what it wrote", () => {
      expect(() => read("stale.txt")).toThrow();
      expect(written.map((f) => f.path)).toEqual([...written.map((f) => f.path)].sort((a, b) => a.localeCompare(b)));
      expect(written.find((f) => f.path === `r/${ID}/home.js`).bytes).toBe(Buffer.byteLength(text[`r/${ID}/home.js`]));
      expect(read("index.html")).toBe(text["index.html"]);
    });

    it("carries a folded release whole: its folder, its media and its redirects, beside this one's", () => {
      expect(read(`r/${OLD}/lobby/main.js`)).toBe(`import "../home.js"; // before`);
      expect(read(`r/${OLD}/lobby/gone.js`)).toBe("export {};");
      expect(read(`r/${OLD}/index.html`)).toContain(`/r/${OLD}/home.js`);
      expect(read(media("old", "mp3"))).toBe("old");
      const lines = read("_redirects").trimEnd().split("\n");
      expect(lines).toContain(`/r/${OLD}/lobby/sounds/old.mp3 /${media("old", "mp3")} 301`);
      expect(lines).toContain(`/r/${OLD}/lobby/sounds/hop.mp3 /${media("hop", "mp3")} 301`);
      expect(lines).toContain(`/r/${ID}/lobby/sounds/hop.mp3 /${media("hop", "mp3")} 301`);
      // Not its passing redirects, nor anything of it outside its folder: those belong to the live release.
      expect(lines.filter((line) => line.endsWith(" 302"))).toEqual([`/game/game/baked/set.glb /${media("glb", "glb")} 302`]);
    });

    it("carries a release from before the folders at its old addresses: what its open pages still load, never its pages", () => {
      expect(read("lobby/main.js")).toBe("// flat main");
      expect(read("lobby/look3d/room3d.js")).toBe("// flat look");
      expect(read("lobby/sounds/hop.mp3")).toBe("flat hop");
      // The pages are this release's, and so is everything else it keeps at its own address.
      expect(read("index.html")).toBe(text["index.html"]);
      expect(read("lobby/index.html")).toBe(text["lobby/index.html"]);
      expect(read("icons/icon.png")).toBe("icon");
      expect(read("_headers")).toBe(text["_headers"]);
      // An address this release redirects is its own too: a file there would never be served.
      expect(() => read("game/game/baked/set.glb")).toThrow();
    });

    it("never lets a carried file replace one of this release's, and the same media is one file", () => {
      const paths = written.map((f) => f.path);
      expect(new Set(paths).size).toBe(paths.length);
      expect(read(media("hop", "mp3"))).toBe("hop");
      expect(read(`r/${ID}/lobby/main.js`)).toBe(text[`r/${ID}/lobby/main.js`]);
    });

    it("refuses to carry a folded build of another release than the one asked for, and to carry itself", () => {
      expect(() => carriedFrom(beforeOut, "cccccccccccc")).toThrow(/cccccccccccc/);
      expect(() => withCarried(plan, [{ id: ID, layout: "folders", files: [], redirects: [] }])).toThrow(/itself/);
    });
  });
});
