// Server code and server-only data never reach a page: the build of public files
// (scripts/build-public.mjs) copies only the folders it names, refuses any inside a server-only
// one, and no file it copies imports one. Paper Masks' questions.js (its ghost answers) lives in
// party/games, with every Table game's rules.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { SERVED, SERVER_ONLY, SOURCES, gameEntries } from "../../scripts/build-public.mjs";
import { GAMES, TURN_GAMES } from "../../games.js";
import { TEST_WALL, WALL, buildTurnWall } from "../wall.js";
import * as countToTen from "../../party/games/count-to-ten/index.js";
import * as paperMasks from "../../party/games/paper-masks/index.js";
import * as paperMasksRules from "../../party/games/paper-masks/rules.js";
import { QUESTIONS } from "../../party/games/paper-masks/questions.js";

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
  });

  it("has no served file that imports server code, or names a Table game's rules or questions", () => {
    const local = SOURCES.filter((from) => inside(resolve(from), ROOT) && !resolve(from).includes(`${sep}node_modules${sep}`));
    const bad = [];
    for (const file of local.flatMap(files)) {
      if (!/\.(m?js|html|json)$/.test(file)) continue;
      const text = readFileSync(file, "utf8");
      // An import of server code by its path in the repository (served pages import by site
      // address; /party/games/... on the site is party/public/games, the views).
      if (/(?:\bfrom|\bimport)\s*\(?\s*["'][^"']*(?:\.\.\/party\/games\/|lobby\/server\/|questions\.js|\/wall\.js|\.\.\/games\.js)/.test(text)) bad.push(relative(ROOT, file));
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
    // The page itself is among them (party/public/games/paper-masks.js and its folder).
    expect(served.map((f) => relative(ROOT, f))).toEqual(expect.arrayContaining(["party/public/games/paper-masks.js", "party/public/games/paper-masks.css"]));
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
});

describe("a Table game that lives in this repository (party/games/<id>)", () => {
  it("needs no package of its own: its view is one of the party's pages, so the build copies nothing for it", () => {
    expect(gameEntries(countToTen)).toEqual([]);
  });

  it("takes Paper Masks from party/games/paper-masks as it is listed: no package, server-only rules, on the Table's list", () => {
    expect(TURN_GAMES).toContain(paperMasks);
    expect(paperMasks.manifest).toMatchObject({ id: "paper-masks", path: "/party/", public: [], table: { view: "games/paper-masks.js" }, players: { min: paperMasksRules.MIN_PLAYERS, max: paperMasksRules.MAX_PLAYERS } });
    expect(gameEntries(paperMasks)).toEqual([]);
    for (const file of ["rules.js", "questions.js", "at-table.js", "index.js", "text.js"]) expect(SERVER_ONLY.some((f) => inside(resolve(ROOT, "party", "games", "paper-masks", file), f)), file).toBe(true);
    const turn = buildTurnWall([paperMasks]);
    expect(turn.table.filter((e) => e.id === "paper-masks")).toEqual([expect.objectContaining({ soon: false, view: "/party/games/paper-masks.js" })]);
    expect(turn.games.get("paper-masks").tickHz).toBe(0);
    expect(WALL.table.find((e) => e.id === "paper-masks")).toMatchObject({ soon: false, test: false });
  });

  it("is refused, with what to do, when it lists public files without being a package", () => {
    const listed = { manifest: { id: "not-a-package", path: "/party/", public: [{ from: "x.js", to: "x.js" }] } };
    expect(() => gameEntries(listed)).toThrow(/not-a-package lists public files but is not a package/);
  });

  it("still copies a packaged game's public files from its package", () => {
    const entries = gameEntries(GAMES[0]);
    expect(entries.length).toBeGreaterThan(0);
    for (const { from } of entries) expect(from).toContain(`${sep}node_modules${sep}cork-and-bell${sep}`);
  });

  it("has every Table game's view served from a file that exists", () => {
    for (const entry of TEST_WALL.table.filter((e) => e.view)) {
      const site = entry.view.replace(/^\//, "");
      const i = SERVED.findIndex((to) => site === to || site.startsWith(to + "/"));
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
