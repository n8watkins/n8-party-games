// Server code and server-only data never reach a page: the build of public files
// (scripts/build-public.mjs) copies only the folders it names, refuses any inside a server-only
// one, and no file it copies imports one. Paper Masks' questions.js (its ghost answers) and Who Am
// I?'s names live in their packages (games/<id>), server only but for their public/ folders; the
// test game's rules live in party/games.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import * as paperMasks from "paper-masks";
import { QUESTIONS } from "paper-masks/questions";
import * as paperMasksRules from "paper-masks/rules";
import { describe, expect, it } from "vitest";
import { SERVED, SERVER_ONLY, SOURCES, gameEntries, tableServerParts } from "../../scripts/build-public.mjs";
import { GAMES, TURN_GAMES } from "../../games.js";
import { TEST_WALL, WALL, buildTurnWall } from "../wall.js";
import * as whoAmI from "who-am-i";
import { IDENTITIES } from "who-am-i/deck";
import * as countToTen from "../../party/games/count-to-ten/index.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const inside = (path, folder) => path === folder || path.startsWith(folder + sep);

/** Every module specifier a file imports: static imports, bare `import "x"`, re-exports and import(). */
function importsOf(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  const found = [];
  for (const m of code.matchAll(/\b(?:import|export)\s*(?:[\w*{}\s,$]+?\s*from\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) found.push(m[1] ?? m[2]);
  return found;
}

function files(path) {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => files(join(path, name)));
}

describe("what the site serves", () => {
  it("names party/games and the room's own code as server-only", () => {
    expect(SERVER_ONLY.map((p) => relative(ROOT, p))).toEqual(expect.arrayContaining(["lobby/server", "party/games", "worker.js", "games.js"]));
  });

  it("copies nothing from a server-only folder, nor any folder that holds one", () => {
    for (const from of SOURCES) {
      for (const folder of SERVER_ONLY) {
        expect(inside(resolve(from), folder), relative(ROOT, from)).toBe(false);
        expect(inside(folder, resolve(from)), relative(ROOT, from)).toBe(false);
      }
    }
    expect(SERVED).toContain("party");
    expect(SERVED.some((to) => to.startsWith("party/games") && !to.startsWith("party/games/"))).toBe(false);
    // Nothing copied names the source folder of a Table game's rules either.
    expect(SOURCES.some((from) => resolve(from) === resolve(ROOT, "games", "paper-masks"))).toBe(false);
  });

  it("has no served file that imports server code, or names a Table game's rules or questions", () => {
    const local = SOURCES.filter((from) => inside(resolve(from), ROOT) && !resolve(from).includes(`${sep}node_modules${sep}`));
    const bad = [];
    for (const file of local.flatMap(files)) {
      if (!/\.(m?js|html|json)$/.test(file)) continue;
      const text = readFileSync(file, "utf8");
      // An import of server code by its path in the repository (served pages import by site
      // address; /party/games/... on the site is party/public/games and the Table games' public/
      // folders, the views), or of a Table game's package or the kit's Table code by name.
      if (/(?:\bfrom|\bimport)\s*\(?\s*["'][^"']*(?:\.\.\/party\/games\/|lobby\/server\/|questions\.js|\/wall\.js|\.\.\/games\.js)/.test(text)) bad.push(relative(ROOT, file));
      if (/(?:\bfrom|\bimport)\s*\(?\s*["'](?:n8-party-games\/table|(?:paper-masks|who-am-i)(?:["']|\/))/.test(text)) bad.push(`${relative(ROOT, file)} imports server code by package name`);
      // A relative import, however many ../ it takes, resolved against the file's own folder.
      for (const spec of importsOf(text)) {
        if (!spec.startsWith("./") && !spec.startsWith("../")) continue;
        const target = resolve(dirname(file), spec);
        const folder = SERVER_ONLY.find((f) => inside(target, f));
        if (folder) bad.push(`${relative(ROOT, file)} imports ${spec} (server-only ${relative(ROOT, folder)})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("holds none of Paper Masks' deck: no prompt and no ghost answer is in any served file, the game's own page included", () => {
    const local = SOURCES.filter((from) => inside(resolve(from), ROOT) && !resolve(from).includes(`${sep}node_modules${sep}`));
    const served = local.flatMap(files).filter((file) => /\.(m?js|html|json|css|txt|md|svg|webmanifest)$/.test(file));
    // The page itself is among them (games/paper-masks/public/paper-masks.js and its folder).
    expect(served.map((f) => relative(ROOT, f))).toEqual(expect.arrayContaining(["games/paper-masks/public/paper-masks.js", "games/paper-masks/public/paper-masks.css"]));
    const secrets = QUESTIONS.flatMap((q) => [q.text, ...q.ghosts]);
    expect(secrets.length).toBeGreaterThan(200);
    const found = [];
    for (const file of served) {
      const text = readFileSync(file, "utf8");
      for (const s of secrets) if (text.includes(s)) found.push(`${relative(ROOT, file)}: ${s}`);
      if (/questions\.js|at-table\.js|paper-masks\/rules\.js/.test(text)) found.push(`${relative(ROOT, file)} names a Paper Masks server file`);
    }
    expect(found).toEqual([]);
  });

  it("holds none of Who Am I?'s names: no hint, picture address or name list is in any served file, the game's own page included", () => {
    const local = SOURCES.filter((from) => inside(resolve(from), ROOT) && !resolve(from).includes(`${sep}node_modules${sep}`));
    const served = local.flatMap(files).filter((file) => /\.(m?js|html|json|css|txt|md|svg|webmanifest)$/.test(file));
    expect(served.map((f) => relative(ROOT, f))).toEqual(expect.arrayContaining(["games/who-am-i/public/who-am-i.js", "games/who-am-i/public/who-am-i.css"]));
    const secrets = IDENTITIES.flatMap((i) => [...i.hints, ...(i.picture ? [i.picture.imageUrl] : [])]);
    expect(secrets.length).toBeGreaterThan(700);
    const found = [];
    for (const file of served) {
      const text = readFileSync(file, "utf8");
      for (const s of secrets) if (text.includes(s)) found.push(`${relative(ROOT, file)}: ${s}`);
      if (/deck-data\.js|who-am-i\/deck\.js|who-am-i\/rules\.js/.test(text)) found.push(`${relative(ROOT, file)} names a Who Am I? server file`);
    }
    expect(found).toEqual([]);
    // The game's own page names no name from the deck at all.
    const page = readFileSync(resolve(ROOT, "games/who-am-i/public/who-am-i.js"), "utf8");
    expect(IDENTITIES.filter((i) => i.name.length > 4 && page.includes(i.name)).map((i) => i.name)).toEqual([]);
  });
});

describe("a Table game that lives in this repository (party/games/<id>)", () => {
  it("needs no package of its own: its view is one of the party's pages, so the build copies nothing for it", () => {
    expect(gameEntries(countToTen)).toEqual([]);
    expect(tableServerParts(countToTen)).toEqual([]);
  });

  it("is refused, with what to do, when it lists public files without being a package", () => {
    const listed = { manifest: { id: "not-a-package", path: "/party/", public: [{ from: "x.js", to: "x.js" }] } };
    expect(() => gameEntries(listed)).toThrow(/not-a-package lists public files but is not a package/);
  });
});

describe("a Table game that is a package of this repository (games/<id>)", () => {
  it("takes Paper Masks from games/paper-masks: its view from public/ at the same addresses, every other file server only, on the Table's list", () => {
    expect(TURN_GAMES).toContain(paperMasks);
    expect(paperMasks.manifest).toMatchObject({ id: "paper-masks", path: "/party/", table: { view: "games/paper-masks.js" }, players: { min: paperMasksRules.MIN_PLAYERS, max: paperMasksRules.MAX_PLAYERS } });
    const folder = resolve(ROOT, "games", "paper-masks");
    expect(gameEntries(paperMasks)).toEqual([
      { from: join(folder, "public", "paper-masks.js"), to: "party/games/paper-masks.js" },
      { from: join(folder, "public", "paper-masks.css"), to: "party/games/paper-masks.css" },
      { from: join(folder, "public", "paper-masks"), to: "party/games/paper-masks" },
    ]);
    for (const file of ["rules.js", "questions.js", "at-table.js", "index.js", "text.js", "test", "tools", "package.json"]) expect(SERVER_ONLY.some((f) => inside(join(folder, file), f)), file).toBe(true);
    for (const file of ["public/paper-masks.js", "public/paper-masks.css", "public/paper-masks/art/door-480.webp"]) expect(SERVER_ONLY.some((f) => inside(join(folder, file), f)), file).toBe(false);
    const turn = buildTurnWall([paperMasks]);
    expect(turn.table.filter((e) => e.id === "paper-masks")).toEqual([expect.objectContaining({ soon: false, view: "/party/games/paper-masks.js" })]);
    expect(turn.games.get("paper-masks").tickHz).toBe(0);
    expect(WALL.table.find((e) => e.id === "paper-masks")).toMatchObject({ soon: false, test: false });
  });

  it("takes Who Am I? from games/who-am-i the same way: its names and rules server only, its view at the same addresses", () => {
    expect(TURN_GAMES).toContain(whoAmI);
    const folder = resolve(ROOT, "games", "who-am-i");
    expect(gameEntries(whoAmI)).toEqual([
      { from: join(folder, "public", "who-am-i.js"), to: "party/games/who-am-i.js" },
      { from: join(folder, "public", "who-am-i.css"), to: "party/games/who-am-i.css" },
      { from: join(folder, "public", "who-am-i"), to: "party/games/who-am-i" },
    ]);
    for (const file of ["rules.js", "deck.js", "deck-data.js", "index.js", "test", "tools", "package.json"]) expect(SERVER_ONLY.some((f) => inside(join(folder, file), f)), file).toBe(true);
    for (const file of ["public/who-am-i.js", "public/who-am-i.css", "public/who-am-i/door.svg"]) expect(SERVER_ONLY.some((f) => inside(join(folder, file), f)), file).toBe(false);
    expect(WALL.table.find((e) => e.id === "who-am-i")).toMatchObject({ soon: false, test: false, view: "/party/games/who-am-i.js" });
  });

  it("still copies a packaged game's public files from its package", () => {
    const entries = gameEntries(GAMES[0]);
    expect(entries.length).toBeGreaterThan(0);
    for (const { from } of entries) expect(from).toContain(`${sep}node_modules${sep}cork-and-bell${sep}`);
  });

  it("has every Table game's view served from a file that exists", () => {
    for (const entry of TEST_WALL.table.filter((e) => e.view)) {
      const site = entry.view.replace(/^\//, "");
      // The most particular entry that serves it (a Table game's own file, beside the party's folder).
      const under = SERVED.map((to, i) => (site === to || site.startsWith(to + "/") ? i : -1)).filter((i) => i > -1);
      const i = under.sort((a, b) => SERVED[b].length - SERVED[a].length)[0] ?? -1;
      expect(i, entry.view).toBeGreaterThan(-1);
      const file = join(SOURCES[i], site.slice(SERVED[i].length));
      expect(statSync(file).isFile(), file).toBe(true);
      expect(SERVER_ONLY.some((f) => inside(file, f)), file).toBe(false);
    }
  });
});

describe("the served-files import check", () => {
  it("finds every kind of import specifier, and none in a comment", () => {
    const text = [
      `import a from "./a.js";`,
      `import { b, c } from '../b.js';`,
      `import "../side.js";`,
      `export { d } from "./d.js";`,
      `export * from "./e.js";`,
      `const f = await import("./f.js");`,
      `import {\n  g,\n} from "./g.js";`,
      `// import "./h.js";`,
      `/* import "./i.js"; */`,
    ].join("\n");
    expect(importsOf(text)).toEqual(["./a.js", "../b.js", "../side.js", "./d.js", "./e.js", "./f.js", "./g.js"]);
  });
});
