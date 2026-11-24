// Builds dist/public, the only folder the Worker serves as static files.
//
// The work is done by the kit. Each hosted game (games.js) lists its public files in its
// manifest; they are copied from the game's package in node_modules to the game's path on the
// site, beside the kit's browser files (party-kit/build/public.mjs). Nothing else can reach the
// site. That tree is then laid out in release folders (party-kit/build/folders.mjs): the pages at
// their own addresses, everything else under /r/<release id>/ and /m/<hash>, kept by a browser
// for a year, so a returning phone asks for almost nothing.
// Wrangler runs this before `wrangler dev` and `wrangler deploy` (the "build" key in
// wrangler.jsonc) and again whenever a watched folder changes.
//
//   node scripts/build-public.mjs            build, print a one-line summary
//   node scripts/build-public.mjs --list     build and list every file that will be served
//   node scripts/build-public.mjs --preview  also build the pages that are not approved yet (below)
//   node scripts/build-public.mjs --production  the deploy's build: refuses a dirty working tree
//   node scripts/build-public.mjs --out=DIR  the site into DIR/public and the Worker's record into
//                                            DIR/release.js, nothing in dist/. With no network and
//                                            nothing carried: THIS IS HOW A LATER DEPLOY BUILDS
//                                            THIS COMMIT AGAIN to carry its files
//                                            (scripts/carried.mjs), so it must keep working, and
//                                            keep giving the same release id, for as long as a
//                                            deploy may carry this commit.
//   node scripts/build-public.mjs --carry=live [--out=DIR]
//                                            also hold the files of the releases the live site
//                                            names, as a deploy does (it needs the network): a
//                                            dress rehearsal of a deploy's build.
//   node scripts/build-public.mjs --preview --out=DIR --salt=TEXT [--flat] [--carry=DIR,DIR]
//                                            a local test build (lobby/test/e2e-release.mjs): TEXT
//                                            makes the same files another release; --flat builds
//                                            the site as it was before release folders; --carry
//                                            names the builds (their --out folders) whose files
//                                            it holds too. Refused with --production and on an
//                                            upload (testBuildProblem).
//
// A deploy (an upload) carries the two releases before it by itself, or fails saying why
// (scripts/carried.mjs). Every build writes the release record (scripts/release.mjs):
// dist/release.js for the Worker, the same at /release.js, and the pages' part of it (the id and
// the site's version) as release.js in the release's folder.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { IMMUTABLE_PATHS, PAGE_MIRROR, RELEASE_DIR, carriedFrom, foldTree, planFiles, withCarried, writePlan } from "../party-kit/build/folders.mjs";
import { KIT_CLIENT_PATH, buildPublic, headersFile, kitClientEntry, report, roomMakingPages } from "../party-kit/build/public.mjs";
import { CARRIED_RELEASES, builtIn, carriedFromLive, carryWanted } from "./carried.mjs";
import { CARRY_LIVE, ID_PLACEHOLDER, PREVIEW_DIR, RELEASE_FILE, buildKind, flatReleaseId, gitState, pageRecord, releaseId, releaseModule, releaseProblem, releaseRecord, testBuildProblem } from "./release.mjs";

/** Where Who Am I?'s pictures load from: the one outside host any page of this site may show images from. */
export const PICTURE_HOST = "https://upload.wikimedia.org";
/** The Table's pages (party/public and the Table games' views, served at /party/): the only ones that may. */
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
 * as Count to ten does): its rules are server-only and its view is one of the party's own pages
 * (party/public/games), already served with them, so it lists no public files and has no package
 * to look up. One that lists public files must be a package (a dependency, or one of this
 * repository's games/ folders, each an npm workspace): they are copied from the package's
 * folder, never from party/games.
 */
export function gameEntries({ manifest }) {
  const files = manifest.public ?? [];
  if (!files.length) return [];
  const from = packageFolder(manifest.id);
  if (!from) throw new Error(`build-public: ${manifest.id} lists public files but is not a package (add it to devDependencies or games/, or keep its view in party/public/games and list none)`);
  const under = manifest.path.replace(/^\/|\/$/g, "");
  return files.map((file) => ({ from: join(from, file.from), to: `${under}/${file.to}` }));
}

/** The folder of the package named `id` (its real folder: a workspace's is in games/), or null. */
function packageFolder(id) {
  try {
    return dirname(realpathSync(require.resolve(`${id}/package.json`)));
  } catch {
    return null;
  }
}

/**
 * A Table game's server-only parts, when it is a package: everything in its folder but what its
 * manifest lists as public (the view and what the view loads). A Table game's rules hold what no
 * page may see (Paper Masks' deck and ghost answers), so its folder is server code apart from
 * those files, like party/games.
 */
export function tableServerParts({ manifest }) {
  const folder = packageFolder(manifest.id);
  if (!folder) return [];
  const shown = (manifest.public ?? []).map((file) => resolve(folder, file.from));
  const keep = (path) => shown.some((p) => p === path || p.startsWith(path + sep));
  const parts = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (shown.includes(path)) continue;
      // A folder that holds a public file is walked into; anything else is server only whole.
      if (keep(path)) walk(path);
      else parts.push(path);
    }
  };
  walk(folder);
  return parts;
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
  // Where a page's own files are served from: the address of a file the room names by site path (a game's view, its picture).
  { from: join(ROOT, "site", "site-path.js"), to: "site-path.js" },
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
  { from: join(ROOT, "games", "hot-potato", "lab", "public"), to: "lab/hot-potato" }, // unlisted, throwaway: the Hot Potato hearing test
  // One-device games: one phone or browser passed around the group, no server. Hot Potato's page,
  // and beside it the matcher and word lists it shares with the hearing test (one copy, two pages).
  // All three are kept in the game's own folder, games/hot-potato.
  { from: join(ROOT, "games", "hot-potato", "public"), to: "one-device/hot-potato" },
  { from: join(ROOT, "games", "hot-potato", "shared"), to: "one-device/hot-potato/shared" },
  // The Star Lounge's numbers, which its Blender scene and its rendered drawing in the room share (one file, not a copy).
  { from: join(ROOT, "lobby", "tools", "blender", "star-lounge.json"), to: "lobby/look3d/rendered/star-lounge/layers/star-lounge.json" },
];

/**
 * Pages still waiting for the owner's approval. They are built only with --preview, which the
 * local environment's build command passes (wrangler.jsonc, env.local) and the production one
 * does not, so they can be opened locally at /preview/... and never reach the live site.
 */
const previewEntries = [{ from: join(ROOT, "landing", "public"), to: `${PREVIEW_DIR}/landing` }];

/**
 * Every flag the command line takes, and what it does. A flag not listed here is refused
 * (readArgs), so a new one has to be added here, where site/test/release.test.js builds with each
 * and fails if any of them changes the release id: only the files a deploy ships may.
 * --out=DIR and --salt=TEXT (with a value) are the local test build's (testBuildProblem).
 */
export const BUILD_FLAGS = {
  "--preview": "also builds the pages still waiting for approval, under preview/ (not part of the release id)",
  "--production": "refuses a tree a deploy may not ship (releaseProblem)",
  "--list": "lists every file built",
};

/**
 * The command line read: {preview, production, list, out, salt, carry, flat, problem}. `problem`
 * names a flag it does not take. `--out`, `--salt` and `--carry` take a value; `--flat` (the
 * site as before release folders, for the release test) is not in BUILD_FLAGS because it is
 * another site, and so another release.
 */
export function readArgs(argv = process.argv) {
  const args = argv.slice(2);
  const value = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  // "--out DIR" (a space, not "=") would otherwise be ignored and build into dist/public.
  const spaced = args.find((a) => /^--(out|salt|carry)=?$/.test(a))?.replace("=", "");
  const unknown = args.find((a) => !(a in BUILD_FLAGS) && a !== "--flat" && !/^--(out|salt|carry)=./.test(a) && !/^--(out|salt|carry)=?$/.test(a));
  const problem = spaced
    ? `write ${spaced}=VALUE, with "=": ${spaced} VALUE is not read.`
    : unknown
      ? `${unknown} is not a flag this build takes (${Object.keys(BUILD_FLAGS).join(", ")}, --out=DIR, --salt=TEXT, --carry=live or DIR,DIR, --flat).`
      : null;
  return { preview: args.includes("--preview"), production: args.includes("--production"), list: args.includes("--list"), flat: args.includes("--flat"), out: value("out"), salt: value("salt"), carry: value("carry"), problem };
}

const PREVIEW = readArgs().preview;

/** What a build copies: with `preview`, the pages still waiting for approval too. */
function entriesFor(preview) {
  // A Table game's public files (its view) come from its package as any hosted game's do.
  return [kitClientEntry(), ...siteEntries, ...[...GAMES, ...TURN_GAMES].flatMap(gameEntries), ...(preview ? previewEntries : [])];
}
const entries = entriesFor(PREVIEW);

/**
 * Folders that hold server code and server-only data, never sent to a page: the room's own code,
 * and the Table games' rules (party/games, and each Table game package's folder but its public
 * files: Paper Masks' questions.js holds its ghost answers). The build refuses to copy anything
 * from inside them, or any folder that holds one of them.
 */
export const SERVER_ONLY = [join(ROOT, "lobby", "server"), join(ROOT, "party", "games"), join(ROOT, "worker.js"), join(ROOT, "games.js"), ...TURN_GAMES.flatMap(tableServerParts)];
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
 * The site's headers, but for the pages that may run the bot check, which are found in what was
 * built. The party room shows a hosted game by putting the game's own page in a frame, so this
 * site's pages may be framed by this site's pages, and by nobody else. Hot Potato
 * (/one-device/hot-potato/) and its hearing test (/lab/hot-potato/) listen through the microphone; no
 * other page may. Who Am I? at the Table shows each name's picture straight from Wikimedia, as
 * its own site does (games/who-am-i/README.md, "For the page builder"): the Table's pages,
 * and only those, may load pictures from there. Only the pages that make rooms (those that load
 * the kit's bot check: the party room's way in, the Table's start page, a hosted game's own page
 * with the kit's lobby) may load anything from Turnstile (party-kit/build/public.mjs, roomMakingPages).
 */
const HEADERS = { frames: "self", microphone: ["/lab/hot-potato/*", "/one-device/hot-potato/*"], images: { [TABLE_PAGES]: [PICTURE_HOST] } };

/**
 * What stays at its own address as well as in the release's folder, as a real file: what
 * something other than a page's own code reads there. An installed site ("Add to Home Screen")
 * reads its manifest and the manifest's icons by these addresses; the release record at
 * /release.js says what is live to anyone who looks (the pages read their own, in their folder).
 */
export const STABLE = ["manifest.webmanifest", "icons", RELEASE_FILE];

/**
 * Media that a page still asks for at its old address, sent on to the media by a redirect that is
 * never kept (party-kit/build/folders.mjs, foldTree's `stableMedia`). Cork & Bell's own page
 * (/cork-and-bell/) names its baked set from the page ("game/baked/set.glb"), not from the module
 * (its package is another repository, pinned in package.json). Shown in the party room's frame it
 * is loaded from the release's folder and needs none of this. Take the entry out once the game
 * names them from import.meta.url.
 */
export const STABLE_MEDIA = ["cork-and-bell/game/baked"];

/**
 * Builds the site as a flat tree into `out`: every file at its own site path, as the kit's
 * buildPublic writes it, with the front page's wall. This is what the pages are written against
 * (a module imports "/party-kit/client/sounds.js"), what the module graph is read from, and what
 * the site was before release folders. Returns every file as `{path, bytes}`. No release record.
 */
export function buildTree(out, { preview = PREVIEW } = {}) {
  const files = buildPublic({ out, entries: entriesFor(preview), ...HEADERS, botCheck: "room-making", computedImports: COMPUTED_IMPORTS });
  const text = homeWallModule();
  writeFileSync(join(out, HOME_WALL_PATH), text);
  return [...files, { path: HOME_WALL_PATH, bytes: Buffer.byteLength(text) }].sort((a, b) => a.path.localeCompare(b.path));
}

const isPreview = (path) => path.startsWith(`${PREVIEW_DIR}/`);
/** The preview pages' files in any release's folder: asked for again each time (headersFile's `fresh`). */
export const PREVIEW_FRESH = `${PAGE_MIRROR}/${PREVIEW_DIR}/*`;
/** The release record's own files in a folded site: never part of the id they hold. */
const isRecord = (path, id) => path === RELEASE_FILE || path === `${RELEASE_DIR}/${id}/${RELEASE_FILE}`;

/** How the site's version is named among the hashed files: no file can have this name (a ":" is not in a site path). */
const SITE_VERSION = ":site";

/**
 * The release id of a folded site. `plan` (party-kit/build/folders.mjs, foldTree) is the site as
 * built with ID_PLACEHOLDER where the id goes: every file it serves, its headers and its
 * redirects are hashed, and the record's own files are not. So a change to anything a browser
 * could be sent is another release, the way the build lays the files out included. `site`, the
 * site's version, is hashed too: the pages show it (from the record in the release's folder,
 * pageRecord), so a version bump alone is another release, and an address in a release's folder
 * never serves other bytes.
 */
export function planId(plan, { salt = "", site = "" } = {}) {
  const shipped = [...planFiles(plan).filter((f) => !isRecord(f.path, plan.id)), ...(site ? [{ path: SITE_VERSION, data: Buffer.from(site) }] : [])];
  const byPath = new Map(shipped.map((f) => [f.path, f]));
  return releaseId(shipped, (path) => byPath.get(path).data ?? readFileSync(byPath.get(path).from), salt);
}

/**
 * Builds the public folder into `out`, dist/public unless told otherwise. The unit tests build
 * into a temporary folder of their own, so they never empty the folder a local Worker serves.
 *
 * The flat tree is built in a temporary folder, then laid out in release folders in `out`
 * (party-kit/build/folders.mjs). The release id is the hash of that site as built with
 * ID_PLACEHOLDER where the id goes (so it covers every file as served, the headers and the
 * redirects), without the preview pages and without what it carries; the site is then built with
 * the id. The release record goes to /release.js, and to `workerRelease` too when given (the
 * command line gives WORKER_RELEASE); the release's folder gets the pages' part of it (its id and
 * the site's version: scripts/release.mjs, pageRecord).
 *
 * - `git` is the commit and tree state to record (gitState).
 * - `preview` adds the pages still waiting for approval (--preview).
 * - `salt` makes the same files another release (a test build).
 * - `carry` is the builds whose files this one also holds, newest first, each `{id, commit, dir}`
 *   (`dir` a built public folder), or a function that gives them for this build's id: the first
 *   CARRIED_RELEASES that are not this very release are carried (scripts/carried.mjs).
 * - `flat` builds the site as it was before release folders instead: the flat tree itself, with
 *   its record and the id that build gave it (a test build).
 */
export function build(out = OUT, { workerRelease = null, git = repoState(), salt = "", preview = PREVIEW, carry = [], flat = false } = {}) {
  const games = [...GAMES, ...TURN_GAMES];
  const writeRecord = (record, paths) => {
    const text = releaseModule(record);
    for (const path of paths) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    }
    return Buffer.byteLength(text);
  };
  if (flat) {
    const files = buildTree(out, { preview });
    const bytes = writeRecord(releaseRecord({ root: ROOT, id: flatReleaseId(out, salt), games, git }), [join(out, RELEASE_FILE), ...(workerRelease ? [workerRelease] : [])]);
    return [...files, { path: RELEASE_FILE, bytes }].sort((a, b) => a.path.localeCompare(b.path));
  }
  const tree = mkdtempSync(join(tmpdir(), "party-tree-"));
  try {
    const paths = buildTree(tree, { preview }).map((f) => f.path);
    // The record's place in the tree, so that a module's import of "/release.js" is one of the
    // tree's files (and lands in the release's folder); the record itself is written last.
    writeFileSync(join(tree, RELEASE_FILE), "");
    paths.push(RELEASE_FILE);
    const botCheck = roomMakingPages(tree, { computedImports: COMPUTED_IMPORTS });
    // The preview pages a local build adds are no part of the release id, so their files can
    // change while the release's folder keeps its name: in the folder they are asked for again
    // each time (PREVIEW_FRESH), or a local browser would keep an edited file's old copy.
    const fold = (files, id, pages) =>
      foldTree({
        tree,
        files,
        id,
        stable: STABLE,
        stableMedia: STABLE_MEDIA,
        headers: ({ scripts }) => headersFile(scripts, { ...HEADERS, botCheck: pages, immutable: IMMUTABLE_PATHS, mirrors: [PAGE_MIRROR], noindex: [`/${RELEASE_DIR}/*`], fresh: files.some(isPreview) ? [PREVIEW_FRESH] : [] }),
      });
    // The id: of the site a deploy ships (no preview pages), as built with the placeholder.
    const site = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
    const id = planId(fold(paths.filter((p) => !isPreview(p)), ID_PLACEHOLDER, botCheck.filter((p) => !isPreview(p.slice(1)))), { salt, site });
    // The site itself, then the releases before it.
    const plan = fold(paths, id, botCheck);
    const carried = [];
    for (const before of typeof carry === "function" ? carry(id) : carry) {
      if (carried.length === CARRIED_RELEASES) break;
      if (before.id === id || carried.some((c) => c.id === before.id)) continue;
      carried.push({ ...carriedFrom(before.dir, before.id), commit: before.commit });
    }
    const written = writePlan(out, withCarried(plan, carried));
    const record = releaseRecord({ root: ROOT, id, games, git, carries: carried });
    // The whole record for the Worker and at /release.js (asked for again each time); in the
    // release's folder, kept for a year, only what the id decides (pageRecord).
    const bytes = writeRecord(record, [join(out, RELEASE_FILE), ...(workerRelease ? [workerRelease] : [])]);
    const pageBytes = writeRecord(pageRecord(record), [join(out, RELEASE_DIR, id, RELEASE_FILE)]);
    return written.map((f) => (f.path === RELEASE_FILE ? { ...f, bytes } : isRecord(f.path, id) ? { ...f, bytes: pageBytes } : f));
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
}

/** This repository's state for the record: dirty includes a gitignored file in any folder the site serves (gitState). */
export function repoState() {
  return gitState(ROOT, { sources: SOURCES });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const git = repoState();
  // An upload (wrangler deploy) is held to the deploy's rules whatever flags the command has.
  const upload = buildKind() === "upload";
  const args = readArgs();
  const production = args.production;
  // A local test build into a folder of its own, its release made another by a salt (testBuildProblem).
  const test = { out: args.out, salt: args.salt, flat: args.flat, carry: args.carry };
  const problem = args.problem ?? testBuildProblem(test, { upload, production }) ?? (upload || production ? releaseProblem(git, { upload }) : null);
  if (problem) {
    console.error(`build-public: ${problem}`);
    process.exit(1);
  }
  const out = test.out ? join(resolve(test.out), "public") : OUT;
  const workerRelease = test.out ? join(resolve(test.out), RELEASE_FILE) : WORKER_RELEASE;
  // What it carries: a deploy, the releases the live site names, built again from their commits
  // (or it fails, saying why); a test build, the builds it names; any other build, nothing.
  let live = null;
  try {
    const wanted = carryWanted({ carry: args.carry, upload });
    let carry = [];
    if (wanted === "none") console.error("build-public: RELEASE_CARRY=none: this build holds no release before its own. Pages still open on one may fail to load a part until they reload.");
    else if (wanted === CARRY_LIVE) {
      live = await carriedFromLive({ root: ROOT });
      carry = live.carry;
    } else if (wanted) carry = wanted.dirs.map((dir) => builtIn(resolve(dir)));
    report(build(out, { workerRelease, git, salt: test.salt ?? "", carry, flat: test.flat }), out);
  } catch (err) {
    // A refusal says all there is to say; anything else is a fault of the build, shown whole.
    console.error(`build-public: ${err.refusal ? err.message : (err.stack ?? err.message)}`);
    process.exitCode = 1;
  } finally {
    live?.cleanup();
  }
}
