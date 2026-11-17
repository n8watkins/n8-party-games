// The front page never offers what the site does not serve. What it calls playable comes from
// the production wall (lobby/wall.js, copied by the build to /home-wall.js) and from the
// one-device games' own pages; every way out it offers is a page the site serves.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HOME_WALL_PATH, SERVED, SOURCES, homeWall, homeWallModule } from "../../scripts/build-public.mjs";
import { TURN_GAMES } from "../../games.js";
import { TEST_WALL, WALL, buildTurnWall } from "../../lobby/wall.js";
import * as paperMasksRules from "../../party/games/paper-masks/rules.js";
import { tableGame } from "../../party/games/table-game.js";
import { MAX_PLAYERS, MIN_PLAYERS } from "../../one-device/hot-potato/public/game.js";
import { KINDS, LINKS, ONE_DEVICE } from "../home-data.js";
import { homeModel, isLive, peekOf, tableStart } from "../home-model.js";

/** The site page a path names, as a file the build copies: "/one-device/hot-potato/" -> its index.html. */
function servedPage(path) {
  const want = path.replace(/^\/|\/$/g, "");
  return SERVED.some((to, i) => {
    if (want !== to && !want.startsWith(to + "/")) return false;
    const rest = want.slice(to.length).replace(/^\//, "");
    const file = join(SOURCES[i] ?? "", rest);
    return existsSync(file.endsWith(".html") ? file : join(file, "index.html"));
  });
}

/**
 * Every way the page could be wrong about a game, against the real wall: [] when it is right.
 * A game is "room" only if the wall hangs it with a view the room plays, "table" only if the
 * Table's list can start it, "own-site" only to the wall's own address for it, and "page" only
 * to a page the site serves.
 */
function unbacked(model, wall = WALL) {
  const bad = [];
  const box = (id) => wall.boxes.find((b) => b.id === id && !b.test);
  const entry = (id) => wall.table.find((e) => e.id === id && !e.test);
  for (const g of [...model.room, ...model.table, ...model.device]) {
    const why = `${g.kind}/${g.id} (${g.status})`;
    if (g.status === "room" && !(box(g.id) && !box(g.id).soon && box(g.id).view && wall.games.has(g.id))) bad.push(`${why}: the room does not play it`);
    if (g.status === "table" && !(entry(g.id) && !entry(g.id).soon && wall.games.has(g.id))) bad.push(`${why}: the Table cannot start it`);
    if (g.status === "own-site" && !wall.boxes.some((b) => b.id === g.id && !b.soon && b.url === g.href)) bad.push(`${why}: the wall has no such address for it`);
    if (g.status === "page" && !servedPage(g.href)) bad.push(`${why}: the site does not serve ${g.href}`);
    if (g.status === "soon" && g.kind !== "device" && ((box(g.id) && !box(g.id).soon && g.kind === "room") || (entry(g.id) && !entry(g.id).soon && g.kind === "table"))) bad.push(`${why}: it plays, but the page says it is coming`);
  }
  return bad;
}

/** The front page's model from a wall, through the module the build writes, as the page reads it. */
async function modelFrom(wall) {
  const module = await import(`data:text/javascript,${encodeURIComponent(homeWallModule(wall))}`);
  return homeModel(module);
}

describe("the wall the front page reads", () => {
  it("is written by the build and served at /home-wall.js", () => {
    expect(SERVED).toContain(HOME_WALL_PATH);
    expect(HOME_WALL_PATH).toBe("home-wall.js");
  });

  it("is the production wall, with no test game even where the local wall hangs one", () => {
    const ids = (w) => [...w.floor, ...w.table].map((g) => g.id);
    expect(ids(homeWall(WALL))).not.toContain("coin-flip");
    expect(ids(homeWall(TEST_WALL))).toEqual(ids(homeWall(WALL)));
    expect(homeWall(WALL).floor.map((g) => g.id)).toEqual(WALL.boxes.map((b) => b.id));
  });

  it("carries each game's players and whether it is coming soon, as the wall has them", async () => {
    const { FLOOR, TABLE } = await import(`data:text/javascript,${encodeURIComponent(homeWallModule())}`);
    for (const g of FLOOR) {
      const b = WALL.boxes.find((x) => x.id === g.id);
      expect([g.min, g.max, g.soon, g.inRoom], g.id).toEqual([b.min, b.max, b.soon, !!b.view]);
    }
    for (const g of TABLE) {
      const e = WALL.table.find((x) => x.id === g.id);
      expect([g.min, g.max, g.soon], g.id).toEqual([e.min, e.max, e.soon]);
    }
  });
});

describe("what the front page says is playable", () => {
  it("is all backed by the wall or a page the site serves", async () => {
    const model = await modelFrom(WALL);
    expect(unbacked(model)).toEqual([]);
    // And there is something to play behind every door.
    for (const k of KINDS) expect(model[k.id].some((g) => isLive(g.status)), k.id).toBe(true);
  });

  it("fails when the page would call a game playable that the wall has as coming soon", async () => {
    // A wall copy that has gone stale: Tin Derby marked ready while the room has no such game.
    const stale = { ...WALL, boxes: WALL.boxes.map((b) => (b.id === "tin-derby" ? { ...b, soon: false, view: "/tin-derby/view.js" } : b)) };
    expect(unbacked(await modelFrom(stale))).toEqual(["room/tin-derby (room): the room does not play it"]);
  });

  it("follows the Table's list: Paper Masks is coming soon until the Table can start it", async () => {
    const now = await modelFrom(WALL);
    const listed = TURN_GAMES.some((g) => g.manifest.id === "paper-masks");
    expect(now.table.find((g) => g.id === "paper-masks").status).toBe(listed ? "table" : "soon");
    // The day it is listed (as lobby/test/public-files.test.js lists it), the page offers it at the Table.
    const paperMasks = { manifest: { id: "paper-masks", name: "Paper Masks", path: "/party/", players: { min: paperMasksRules.MIN_PLAYERS, max: paperMasksRules.MAX_PLAYERS }, public: [], table: { view: "games/paper-masks.js" } }, game: tableGame(paperMasksRules) };
    const turn = buildTurnWall([paperMasks]);
    const later = { ...WALL, table: turn.table, games: new Map([...WALL.games, ...turn.games]) };
    const model = await modelFrom(later);
    expect(model.table.find((g) => g.id === "paper-masks")).toMatchObject({ status: "table", min: 3, max: 8 });
    expect(unbacked(model, later)).toEqual([]);
  });

  it("plays Who Am I? on its own site while the Table does not have it", async () => {
    const who = (await modelFrom(WALL)).table.find((g) => g.id === "who-am-i");
    expect(who.status).toBe("own-site");
    expect(who.href).toBe(WALL.boxes.find((b) => b.id === "who-am-i").url);
  });

  it("gives Hot Potato the player counts of its own rules", () => {
    const potato = ONE_DEVICE.find((g) => g.id === "hot-potato");
    expect([potato.min, potato.max]).toEqual([MIN_PLAYERS, MAX_PLAYERS]);
  });
});

/** The wall the day Paper Masks can be started at the Table (as the test above builds it). */
function wallWithPaperMasks() {
  const paperMasks = { manifest: { id: "paper-masks", name: "Paper Masks", path: "/party/", players: { min: paperMasksRules.MIN_PLAYERS, max: paperMasksRules.MAX_PLAYERS }, public: [], table: { view: "games/paper-masks.js" } }, game: tableGame(paperMasksRules) };
  const turn = buildTurnWall([paperMasks]);
  return { ...WALL, table: turn.table, games: new Map([...WALL.games, ...turn.games]) };
}
/** The wall with no game the Table can start: Paper Masks still coming. */
const wallWithoutTableGame = () => ({ ...WALL, table: WALL.table.map((e) => (e.id === "paper-masks" ? { ...e, soon: true } : e)) });
const ids = (games) => games.map((g) => g.id);

describe("what each door's peek calls Now", () => {
  it("is only a game that plays behind that door: Who Am I? plays on its own site, not in the room or at the Table", async () => {
    const model = await modelFrom(wallWithoutTableGame());
    const room = peekOf("room", model.room);
    expect(ids(room.here)).toEqual(["cork-and-bell"]);
    expect(ids(room.elsewhere)).toEqual(["who-am-i"]);
    const table = peekOf("table", model.table);
    expect(ids(table.here)).toEqual([]);
    expect(ids(table.elsewhere)).toEqual(["who-am-i"]);
    expect(ids(table.soon)).toEqual(["paper-masks"]);
    expect(ids(peekOf("device", model.device).here)).toEqual(["hot-potato"]);
  });

  it("calls Paper Masks Now at the Table by itself the day the Table can start it", async () => {
    const table = peekOf("table", (await modelFrom(wallWithPaperMasks())).table);
    expect(ids(table.here)).toEqual(["paper-masks"]);
    expect(ids(table.elsewhere)).toEqual(["who-am-i"]);
    expect(ids(table.soon)).toEqual([]);
  });
});

describe("the Table door's way to start", () => {
  it("leads with the note, not the start, while no game plays at the Table", async () => {
    const start = tableStart(await modelFrom(wallWithoutTableGame()));
    expect(start.lead).toBe("note");
    expect(start.note).toBe("No game plays at the Table yet: Paper Masks is on the way. Who Am I? plays today on its own site.");
  });

  it("leads with the start by itself the day a game plays at the Table", async () => {
    const start = tableStart(await modelFrom(wallWithPaperMasks()));
    expect(start.lead).toBe("start");
    expect(start.note).toMatch(/^The host picks a game at the Table/);
  });

  it("follows the production wall today", async () => {
    const model = await modelFrom(WALL);
    expect(tableStart(model).lead).toBe(model.table.some((g) => g.status === "table") ? "start" : "note");
  });
});

describe("the front page's HTML before its script runs", () => {
  const html = readFileSync(resolve(import.meta.dirname, "..", "index.html"), "utf8");

  it("holds the three ways in as plain links, to where the doors lead", () => {
    const doors = html.match(/<div class="doors[^"]*" id="doors">([\s\S]*?)<\/div>/)?.[1] ?? "";
    const links = [...doors.matchAll(/href="([^"]+)"/g)].map(([, href]) => href);
    expect(links).toEqual([LINKS.floorStart, LINKS.tableStart, ONE_DEVICE[0].path]);
    for (const path of links) expect(servedPage(new URL(path, "https://x.invalid").pathname), path).toBe(true);
  });

  it("loads the room's picture lazily, inside a hidden view", () => {
    expect(html).toMatch(/<img src="\/art\/room-light\.webp"[^>]*loading="lazy"/);
  });
});

describe("the web app manifest", () => {
  const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "manifest.webmanifest"), "utf8"));

  it("names n8games in the front page's words and colours, any way up", () => {
    expect([manifest.name, manifest.short_name]).toEqual(["n8games", "n8games"]);
    expect(manifest.description).toBe("Party games for friends in one room. Free, no app, no sign-up.");
    expect(manifest.description).not.toMatch(/two to four/i);
    expect(manifest.orientation).toBe("any");
    const css = readFileSync(resolve(import.meta.dirname, "..", "site.css"), "utf8");
    // The navy the front page has by night.
    expect(css).toContain(`--ground: ${manifest.theme_color};`);
    expect(manifest.background_color).toBe(manifest.theme_color);
  });
});

describe("every way out of the front page", () => {
  it("is a page the site serves", () => {
    for (const path of [LINKS.floorStart, LINKS.join("1234"), LINKS.tableStart, "/party/", ...ONE_DEVICE.map((g) => g.path)]) {
      expect(servedPage(new URL(path, "https://x.invalid").pathname), path).toBe(true);
    }
  });

  it("hides How it works until its page exists, and links the source", () => {
    expect(LINKS.howItWorks).toBe("");
    expect(LINKS.code).toBe("https://github.com/n8watkins/n8-party-games");
  });

  it("ships the two fonts with their licences", () => {
    const root = resolve(import.meta.dirname, "..");
    for (const f of ["fonts/baloo-2.woff2", "fonts/nunito.woff2", "fonts/BALOO-2-OFL.txt", "fonts/NUNITO-OFL.txt"]) expect(existsSync(join(root, f)), f).toBe(true);
  });
});
