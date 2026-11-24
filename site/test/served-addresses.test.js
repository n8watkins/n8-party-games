// The addresses the in-house games are served at never follow their folders. Each game is kept
// in games/<id> (an npm workspace), but a phone, a bookmark, a shared link and a page already open
// know the game by its address, and those stay as they were before the folders moved: Tin Derby
// under /tin-derby/, the Table games' views under /party/games/, Hot Potato under
// /one-device/hot-potato/ (its matcher and lists under shared/) and its hearing test under
// /lab/hot-potato/. This builds the site as a flat tree and checks every address below is served,
// with the bytes of the file it must come from.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { GAMES, TURN_GAMES } from "../../games.js";
import { buildTree } from "../../scripts/build-public.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const OUT = mkdtempSync(join(tmpdir(), "party-served-"));
afterAll(() => rmSync(OUT, { recursive: true, force: true }));
const built = new Set(buildTree(OUT, { preview: false }).map((f) => f.path));

/** Each pinned address, and the file in the repository it is served from. */
const PINNED = {
  // Tin Derby (games/tin-derby): its page, the view the party room mounts, the rules and numbers the page runs.
  "tin-derby/page/index.html": "games/tin-derby/page/index.html",
  "tin-derby/page/party-view.js": "games/tin-derby/page/party-view.js",
  "tin-derby/shared/rules.js": "games/tin-derby/shared/rules.js",
  "tin-derby/shared/replica.js": "games/tin-derby/shared/replica.js",
  "tin-derby/data/tune.js": "games/tin-derby/data/tune.js",
  // Paper Masks at the Table (games/paper-masks/public).
  "party/games/paper-masks.js": "games/paper-masks/public/paper-masks.js",
  "party/games/paper-masks.css": "games/paper-masks/public/paper-masks.css",
  "party/games/paper-masks/art/door-480.webp": "games/paper-masks/public/paper-masks/art/door-480.webp",
  "party/games/paper-masks/art/table-wide-1536.webp": "games/paper-masks/public/paper-masks/art/table-wide-1536.webp",
  "party/games/paper-masks/fonts/fraunces-latin.woff2": "games/paper-masks/public/paper-masks/fonts/fraunces-latin.woff2",
  // Who Am I? at the Table (games/who-am-i/public).
  "party/games/who-am-i.js": "games/who-am-i/public/who-am-i.js",
  "party/games/who-am-i.css": "games/who-am-i/public/who-am-i.css",
  "party/games/who-am-i/door.svg": "games/who-am-i/public/who-am-i/door.svg",
  "party/games/who-am-i/fonts/nunito-latin-wght-normal.woff2": "games/who-am-i/public/who-am-i/fonts/nunito-latin-wght-normal.woff2",
  // Hot Potato (games/hot-potato): the page, and the matcher and lists it shares with the hearing test.
  "one-device/hot-potato/index.html": "games/hot-potato/public/index.html",
  "one-device/hot-potato/app.js": "games/hot-potato/public/app.js",
  "one-device/hot-potato/game.js": "games/hot-potato/public/game.js",
  "one-device/hot-potato/shared/logic.js": "games/hot-potato/shared/logic.js",
  "one-device/hot-potato/shared/categories.js": "games/hot-potato/shared/categories.js",
  "one-device/hot-potato/shared/cities.json": "games/hot-potato/shared/cities.json",
  "one-device/hot-potato/shared/CREDITS.txt": "games/hot-potato/shared/CREDITS.txt",
  // The hearing test (games/hot-potato/lab/public), which imports the game's shared/ by its address.
  "lab/hot-potato/index.html": "games/hot-potato/lab/public/index.html",
  "lab/hot-potato/app.js": "games/hot-potato/lab/public/app.js",
  // The Table's own test game, which stays one of the party's pages.
  "party/games/count-to-ten.js": "party/public/games/count-to-ten.js",
};

describe("the in-house games' addresses", () => {
  it.each(Object.entries(PINNED))("serves /%s from %s", (address, source) => {
    expect(built.has(address), address).toBe(true);
    expect(readFileSync(join(OUT, address)).equals(readFileSync(join(ROOT, source))), address).toBe(true);
  });

  it("serves every address a hosted game's manifest names: its Floor view, its Table view and its door", () => {
    const named = [];
    for (const { manifest } of [...GAMES, ...TURN_GAMES]) {
      const under = manifest.path.replace(/^\//, "");
      if (manifest.lobby?.view) named.push(under + manifest.lobby.view);
      if (manifest.table?.view) named.push(under + manifest.table.view);
      if (manifest.art) named.push(manifest.art.replace(/^\//, ""));
    }
    expect(named).toEqual(expect.arrayContaining(["tin-derby/page/party-view.js", "party/games/paper-masks.js", "party/games/who-am-i.js", "party/games/paper-masks/art/door-480.webp", "party/games/who-am-i/door.svg"]));
    for (const address of named) expect(built.has(address), address).toBe(true);
  });

  it("keeps the games' paths in their manifests", () => {
    const paths = Object.fromEntries([...GAMES, ...TURN_GAMES].map(({ manifest }) => [manifest.id, manifest.path]));
    expect(paths).toMatchObject({ "tin-derby": "/tin-derby/", "paper-masks": "/party/", "who-am-i": "/party/" });
  });

  it("serves nothing from the old folders' names under a new address", () => {
    expect([...built].filter((path) => /^(games|floor|one-device\/hot-potato\/lab)\//.test(path))).toEqual([]);
  });
});
