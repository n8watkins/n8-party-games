// Builds dist/public, the only folder the Worker serves as static files.
//
// The work is done by the kit (party-kit/build/public.mjs). Each hosted game (games.js) lists
// its public files in its manifest; they are copied from the game's package in node_modules to
// the game's path on the site, beside the kit's browser files. Nothing else can reach the site.
// Wrangler runs this before `wrangler dev` and `wrangler deploy` (the "build" key in
// wrangler.jsonc) and again whenever a watched folder changes.
//
//   node scripts/build-public.mjs            build, print a one-line summary
//   node scripts/build-public.mjs --list     build and list every file that will be served
//   node scripts/build-public.mjs --preview  also build the pages that are not approved yet (below)
//   node scripts/build-public.mjs --production  the deploy's build: refuses a dirty working tree
//   node scripts/build-public.mjs --preview --out=DIR --salt=TEXT
//                                            a local test build (lobby/test/e2e-release.mjs): the
//                                            site into DIR/public and the Worker's record into
//                                            DIR/release.js, nothing in dist/; TEXT makes the same
//                                            files another release. Refused with --production and
//                                            on an upload (testBuildProblem).
//
// Every build writes the release record (scripts/release.mjs): release.js in the public folder for
// the pages, and dist/release.js for the Worker.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { KIT_CLIENT_PATH, buildPublic, kitClientEntry, report } from "../party-kit/build/public.mjs";
import { PREVIEW_DIR, RELEASE_FILE, buildKind, gitState, releaseModule, releaseProblem, releaseRecord, testBuildProblem } from "./release.mjs";

/** Where Who Am I?'s pictures load from: the one outside host any page of this site may show images from. */
export const PICTURE_HOST = "https://upload.wikimedia.org";
/** The Table's pages (party/public, served at /party/): the only ones that may. */
export const TABLE_PAGES = "/party/*";
import { GAMES, TURN_GAMES } from "../games.js";
import { WALL } from "../lobby/wall.js";

/**
 * The files whose import() names a module the build cannot read (party-kit/build/public.mjs,
 * moduleGraph): any other one fails the build. Both load the view of a game the party is playing,
 * named by the room's wall (lobby/wall.js, a box's or a Table entry's `view`), into a party already
 * made; a test checks that no such view loads the bot check.
 */
export const COMPUTED_IMPORTS = ["lobby/main.js", "party/stage.js"];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = join(ROOT, "dist", "public");

const require = createRequire(import.meta.url);

/**
 * One game's public files: from its package's folder to its path on the site.
 *
 * A Table game may live in this repository instead of a package of its own (party/games/<id>,
 * as Count to ten does and Paper Masks will): its rules are server-only and its view is one of
 * the party's own pages (party/public/games), already served with them, so it lists no public
 * files and has no package to look up. One that lists public files must be a package: they are
 * copied from the package's folder, never from party/games.
 */
export function gameEntries({ manifest }) {
  const files = manifest.public ?? [];
  if (!files.length) return [];
  let pkg;
  try {
    pkg = require.resolve(`${manifest.id}/package.json`);
  } catch {
    throw new Error(`build-public: ${manifest.id} lists public files but is not a package (add it to devDependencies, or keep its view in party/public/games and list none)`);
  }
  const from = dirname(pkg);
  const under = manifest.path.replace(/^\/|\/$/g, "");
  return files.map((file) => ({ from: join(from, file.from), to: `${under}/${file.to}` }));
}

/**
 * The site's own pages: the front page, the party room (the lobby) with the plain logic its page
 * shares with the room (lobby/shared), and the party's plain waiting room (party/public). The
 * lobby's server code is not among them.
 */
const siteEntries = [
  // The front page: the three doors (home.js), drawn from home-data.js and the build's copy of the
  // wall (HOME_WALL_PATH, below), with its pictures, its two self-hosted fonts (SIL OFL, licences
  // beside them), and the line about the party this device has just left (front.js).
  { from: join(ROOT, "site", "index.html"), to: "index.html" },
  { from: join(ROOT, "site", "site.css"), to: "site.css" },
  { from: join(ROOT, "site", "front.js"), to: "front.js" },
  { from: join(ROOT, "site", "home.js"), to: "home.js" },
  { from: join(ROOT, "site", "home-data.js"), to: "home-data.js" },
  { from: join(ROOT, "site", "home-model.js"), to: "home-model.js" },
  // The quiet "Version ..., build ..." line the front page, the Floor and the Table show (from release.js, written by the build).
  { from: join(ROOT, "site", "release-line.js"), to: "release-line.js" },
  // "New version available": a page older than the live site loads the new one at a safe moment.
  { from: join(ROOT, "site", "release-switch.js"), to: "release-switch.js" },
  { from: join(ROOT, "site", "art"), to: "art" },
  { from: join(ROOT, "site", "fonts"), to: "fonts" },
  // Starting a party at the Table: the party room's way in, then straight to the Table.
  { from: join(ROOT, "site", "table"), to: "table" },
  // The web app manifest and its icons (scripts/make-icons.py draws them): "Add to Home Screen" opens the site full screen.
  { from: join(ROOT, "site", "manifest.webmanifest"), to: "manifest.webmanifest" },
  { from: join(ROOT, "site", "icons"), to: "icons" },
  // The party's plain waiting room (Turn-based), beside the character room at /lobby/ (lobby/shared/mode.js).
  { from: join(ROOT, "party", "public"), to: "party" },
  { from: join(ROOT, "lobby", "public"), to: "lobby" },
  { from: join(ROOT, "lobby", "shared"), to: "lobby/shared" },
  { from: join(ROOT, "lab", "hot-potato", "public"), to: "lab/hot-potato" }, // unlisted, throwaway: the Hot Potato hearing test
  // One-device games: one phone or browser passed around the group, no server. Hot Potato's page,
  // and beside it the matcher and word lists it shares with the hearing test (one copy, two pages).
  { from: join(ROOT, "one-device", "hot-potato", "public"), to: "one-device/hot-potato" },
  { from: join(ROOT, "one-device", "hot-potato", "shared"), to: "one-device/hot-potato/shared" },
  // The Star Lounge's numbers, which its Blender scene and its rendered drawing in the room share (one file, not a copy).
  { from: join(ROOT, "lobby", "tools", "blender", "star-lounge.json"), to: "lobby/look3d/rendered/star-lounge/layers/star-lounge.json" },
];

/**
 * Pages still waiting for the owner's approval. They are built only with --preview, which the
 * local environment's build command passes (wrangler.jsonc, env.local) and the production one
 * does not, so they can be opened locally at /preview/... and never reach the live site.
 */
const previewEntries = [{ from: join(ROOT, "landing", "public"), to: `${PREVIEW_DIR}/landing` }];
const PREVIEW = process.argv.includes("--preview");

// A Table game's public files (its view) come from its package as any hosted game's do.
const entries = [kitClientEntry(), ...siteEntries, ...[...GAMES, ...TURN_GAMES].flatMap(gameEntries), ...(PREVIEW ? previewEntries : [])];

/**
 * Folders that hold server code and server-only data, never sent to a page: the room's own code,
 * and the Table games' rules (party/games: Paper Masks' questions.js holds its ghost answers). The
 * build refuses to copy anything from inside them, or any folder that holds one of them.
 */
export const SERVER_ONLY = [join(ROOT, "lobby", "server"), join(ROOT, "party", "games"), join(ROOT, "worker.js"), join(ROOT, "games.js")];
const inside = (path, folder) => path === folder || path.startsWith(folder + sep);
for (const { from } of entries) {
  const bad = SERVER_ONLY.find((folder) => inside(resolve(from), folder) || inside(folder, resolve(from)));
  if (bad) throw new Error(`build-public: ${relative(ROOT, from)} would publish server-only ${relative(ROOT, bad)}`);
}

/**
 * The front page's copy of the party room's wall: written by the build, never kept in the
 * repository. The front page shows what the Floor's wall and the Table's list hold in production
 * (lobby/wall.js, WALL), so a game is "playable now" on it only when the room really plays it. The
 * wall itself is server code (it names every game's server definition), so the page gets this
 * plain list instead: names, lines, player counts and whether each is coming soon. Test games
 * are left out (production has none), and so is the wall's poster, which is not a game.
 */
export const HOME_WALL_PATH = "home-wall.js";

/** The plain lists the front page reads: {floor, table}. */
export function homeWall(wall = WALL) {
  const floor = wall.boxes
    .filter((box) => !box.test && !box.poster)
    .map(({ id, name, blurb, min, max, soon, view }) => ({ id, name, line: blurb, min, max, soon, inRoom: !!view }));
  const table = wall.table.filter((entry) => !entry.test).map(({ id, name, pitch, min, max, soon }) => ({ id, name, line: pitch, min, max, soon }));
  return { floor, table };
}

/** The module the build writes at HOME_WALL_PATH. */
export function homeWallModule(wall = WALL) {
  const { floor, table } = homeWall(wall);
  return [
    "// Written by scripts/build-public.mjs from lobby/wall.js (production): do not edit.",
    `export const FLOOR = ${JSON.stringify(floor)};`,
    `export const TABLE = ${JSON.stringify(table)};`,
    "",
  ].join("\n");
}

/** Every site path that is served: the kit's browser files, the site's pages, each game's public files, the front page's wall and the release record. */
export const SERVED = [...entries.map((entry) => entry.to), HOME_WALL_PATH, RELEASE_FILE];
/** Where the Worker's copy of the release record is written (wrangler.jsonc's alias "n8-party-games/release" names it). */
export const WORKER_RELEASE = join(ROOT, "dist", RELEASE_FILE);
/** Where each served path is copied from. */
export const SOURCES = entries.map((entry) => entry.from);

/**
 * Builds the public folder into `out`, dist/public unless told otherwise. The unit tests build
 * into a temporary folder of their own, so they never empty the folder a local Worker serves.
 * The release record goes into `out` as release.js, and to `workerRelease` too when given (the
 * command line gives WORKER_RELEASE). `git` is the commit and tree state to record (gitState).
 */
export function build(out = OUT, { workerRelease = null, git = repoState(), salt = "" } = {}) {
  // The party room shows a hosted game by putting the game's own page in a frame, so this site's
  // pages may be framed by this site's pages, and by nobody else.
  // Hot Potato (one-device/hot-potato) and its hearing test (lab/hot-potato) listen through the
  // microphone; no other page may. Who Am I? at the Table shows each name's picture straight from
  // Wikimedia, as its own site does (party/games/who-am-i/README.md, "For the page builder"): the
  // Table's pages, and only those, may load pictures from there. Only the pages that make rooms
  // (those that load the kit's bot check: the party room's way in, the Table's start page, a
  // hosted game's own page with the kit's lobby) may load anything from Turnstile, found in what
  // was built (party-kit/build/public.mjs, roomMakingPages).
  const files = buildPublic({ out, entries, frames: "self", microphone: ["/lab/hot-potato/*", "/one-device/hot-potato/*"], images: { [TABLE_PAGES]: [PICTURE_HOST] }, botCheck: "room-making", computedImports: COMPUTED_IMPORTS });
  const text = homeWallModule();
  writeFileSync(join(out, HOME_WALL_PATH), text);
  const built = [...files, { path: HOME_WALL_PATH, bytes: Buffer.byteLength(text) }];
  // Last, so its id covers every other file in the folder, `_headers` included.
  const release = releaseModule(releaseRecord({ root: ROOT, out, games: [...GAMES, ...TURN_GAMES], git, salt }));
  writeFileSync(join(out, RELEASE_FILE), release);
  if (workerRelease) {
    mkdirSync(dirname(workerRelease), { recursive: true });
    writeFileSync(workerRelease, release);
  }
  return [...built, { path: RELEASE_FILE, bytes: Buffer.byteLength(release) }].sort((a, b) => a.path.localeCompare(b.path));
}

/** This repository's state for the record: dirty includes a gitignored file in any folder the site serves (gitState). */
export function repoState() {
  return gitState(ROOT, { sources: SOURCES });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const git = repoState();
  // An upload (wrangler deploy) is held to the deploy's rules whatever flags the command has.
  const upload = buildKind() === "upload";
  const production = process.argv.includes("--production");
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  // A local test build into a folder of its own, its release made another by a salt (testBuildProblem).
  const test = { out: arg("out"), salt: arg("salt") };
  // "--out DIR" (a space, not "=") would otherwise be ignored and build into dist/public.
  const spaced = process.argv.find((a) => /^--(out|salt)=?$/.test(a))?.replace("=", "");
  const problem = (spaced ? `write ${spaced}=VALUE, with "=": ${spaced} VALUE is not read.` : null) ?? testBuildProblem(test, { upload, production }) ?? (upload || production ? releaseProblem(git, { upload }) : null);
  if (problem) {
    console.error(`build-public: ${problem}`);
    process.exit(1);
  }
  const out = test.out ? join(resolve(test.out), "public") : OUT;
  const workerRelease = test.out ? join(resolve(test.out), RELEASE_FILE) : WORKER_RELEASE;
  report(build(out, { workerRelease, git, salt: test.salt ?? "" }), out);
}
