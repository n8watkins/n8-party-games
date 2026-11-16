// Server code and server-only data never reach a page: the build of public files
// (scripts/build-public.mjs) copies only the folders it names, refuses any inside a server-only
// one, and no file it copies imports one. Paper Masks' questions.js (its ghost answers) lives in
// party/games, with every Table game's rules.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { SERVED, SERVER_ONLY, SOURCES } from "../../scripts/build-public.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const inside = (path, folder) => path === folder || path.startsWith(folder + sep);

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
    }
    expect(bad).toEqual([]);
  });
});
