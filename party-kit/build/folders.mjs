// Release folders: a built public folder (the flat tree buildPublic writes) laid out so that a
// returning browser asks for almost nothing, and no open page is ever served another release's code.
//
//   /index.html, /lobby/index.html ...   the pages, at their own addresses. Workers sends them
//                                        with "ask again each time", so a page is always the live
//                                        release's. Each points only into its own release's folder.
//   /r/<release id>/...                  every file of the release that is not media, the pages
//                                        included (a game shown in a frame loads its page from here).
//                                        An address in it never serves other bytes: kept for a year.
//   /m/<hash of the bytes>.<ext>         media (pictures, sound, fonts, models, big data), shared by
//                                        every release that holds the same file. Kept for a year.
//   _redirects                           /r/<id>/<path of a media file> -> /m/<hash>.<ext>, for good
//                                        (301, kept for a year like the folder): a module that
//                                        builds an address beside itself (new URL("./x.webp",
//                                        import.meta.url)) lands in its folder and is sent on, once
//                                        per release, with no bytes moved.
//
// A page reaches a file three ways, and each one stays inside the release:
//   - the page's own tags (script, link, img): rewritten here to the file's final address;
//   - a stylesheet's url(): rewritten here, straight to the media;
//   - a module's imports: one by site path ("/party-kit/client/sounds.js") is rewritten to the
//     same file by relative path, so every import resolves beside the module, in its folder. An
//     address a module builds itself must be built from import.meta.url for the same reason; one
//     written as a site path ("/art/x.webp") would leave the folder, and is not found here.
//
// A deploy also carries the releases before it (carriedFrom, withCarried): pages still open on one
// keep loading that release's files until they reload, and a release from before there were
// folders is carried as it was served, at its old addresses.
//
// What Workers does with these files is in its documentation (checked 2026-11-23):
// https://developers.cloudflare.com/workers/static-assets/headers/ (one splat per rule, a
// placeholder is one path segment, 100 rules, 2,000 characters a line),
// https://developers.cloudflare.com/workers/static-assets/redirects/ (static redirects win over a
// file at the same address; 2,000 of them) and
// https://developers.cloudflare.com/workers/versions-and-deployments/version-skew/ (a version
// serves only its own files, so a release must hold what older pages still ask for).
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { init as initLexer, parse as parseModule } from "es-module-lexer";
import { IMMUTABLE, inlineScriptHashesOf } from "./public.mjs";

await initLexer();

export { IMMUTABLE };
/** The folder that holds one folder per release. */
export const RELEASE_DIR = "r";
/** The folder that holds media, each file named by its bytes. */
export const MEDIA_DIR = "m";
/** The folders whose addresses never serve other bytes (headersFile's `immutable`). */
export const IMMUTABLE_PATHS = [`/${RELEASE_DIR}/*`, `/${MEDIA_DIR}/*`];
/** Where each page lives a second time (headersFile's `mirrors`): any release's folder. */
export const PAGE_MIRROR = `/${RELEASE_DIR}/:release`;
/** Workers reads at most this many static redirects from `_redirects`. */
export const MAX_STATIC_REDIRECTS = 2000;
/** Workers refuses a redirect line longer than this. */
const MAX_REDIRECT_LINE = 1000;
/** A data file this big or bigger is media (Hot Potato's word lists); a smaller one stays in the folder. */
export const BIG_JSON_BYTES = 16 * 1024;
/** Hex digits of a media file's hash in its name: 80 bits, far more than any site's files need. */
const MEDIA_HASH_LENGTH = 20;
/**
 * What is media by its extension. Only files that name no other file: a .gltf names its buffers
 * and textures beside itself, which would no longer resolve from /m/, so it stays in the folder
 * (and its neighbours are still found there, and sent on).
 */
const MEDIA_EXTENSIONS = new Set([".webp", ".png", ".jpg", ".jpeg", ".gif", ".avif", ".svg", ".ico", ".mp3", ".ogg", ".wav", ".m4a", ".mp4", ".webm", ".woff", ".woff2", ".ttf", ".otf", ".glb", ".hdr", ".ktx2", ".bin"]);

const extension = (path) => posix.extname(path).toLowerCase();

/** Whether the file at `path`, `bytes` long, is media. */
export function isMedia(path, bytes) {
  const ext = extension(path);
  return MEDIA_EXTENSIONS.has(ext) || (ext === ".json" && bytes >= BIG_JSON_BYTES);
}

/** The site path of a media file with these bytes: named by them, with the extension of `path`. */
export function mediaPath(bytes, path) {
  return `${MEDIA_DIR}/${createHash("sha256").update(bytes).digest("hex").slice(0, MEDIA_HASH_LENGTH)}${extension(path)}`;
}

/** An address split into its path and what follows it (a query, a fragment). */
function split(ref) {
  const at = ref.search(/[?#]/);
  return at < 0 ? [ref, ""] : [ref.slice(0, at), ref.slice(at)];
}

/** Whether an address leaves the site or is no address of a file at all. */
const outside = (ref) => /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("//") || ref.startsWith("#") || ref.startsWith("?") || ref === "";

/**
 * The site path (no leading slash; a folder keeps its trailing slash) that `ref`, written in the
 * file at site path `from`, names; null for an address outside the site.
 */
export function sitePathOf(from, ref) {
  const [path] = split(ref);
  if (outside(path)) return null;
  const joined = path.startsWith("/") ? posix.normalize(path.slice(1)) : posix.normalize(posix.join(posix.dirname(from), path));
  if (joined === "." || joined === "./") return "";
  return joined.startsWith("..") ? null : joined;
}

/**
 * The tags of a page that load a file, and the attributes that name it. Links to pages (a, form)
 * are not among them. `srcset` and `imagesrcset` hold a list of addresses, each with its size.
 */
const LOADING_TAGS = { script: ["src"], link: ["href", "imagesrcset"], img: ["src", "srcset"], source: ["src", "srcset"], audio: ["src"], video: ["src", "poster"], track: ["src"], embed: ["src"], input: ["src"] };
const LISTS = new Set(["srcset", "imagesrcset"]);

/**
 * A page with every file it loads named where the file now is. `to(ref)` gives the new address
 * of what `ref` names, or null to leave it as written (a page, an outside address, a file that
 * keeps its place). An import map's addresses are rewritten the same way. What cannot be
 * rewritten is refused: an inline module script and an inline <style> could each name a file by
 * an address that is gone.
 */
export function rewriteHtml(html, to) {
  const move = (ref) => {
    const [path, rest] = split(ref);
    const moved = path ? to(path) : null;
    return moved === null ? ref : moved + rest;
  };
  if (/<style\b/i.test(html)) throw new Error("a page has an inline <style>, which the build does not rewrite (and the CSP refuses): use a stylesheet");
  // The scripts first, as wholes: an import map's JSON is rewritten, and no other script's text is touched.
  const kept = [];
  const keep = (text) => `\u0000${kept.push(text) - 1}\u0000`;
  const out = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (whole, attrs, body) => {
    const open = `<script${rewriteAttributes(attrs, ["src"], move)}>`;
    if (/\btype\s*=\s*["']importmap["']/i.test(attrs)) return keep(`${open}${rewriteImportMap(body, move)}</script>`);
    if (/\btype\s*=\s*["']module["']/i.test(attrs) && !/\bsrc\s*=/i.test(attrs) && body.trim()) throw new Error("a page has an inline module script, whose imports the build does not rewrite: load it with src");
    return keep(`${open}${body}</script>`);
  });
  const tags = Object.keys(LOADING_TAGS).filter((tag) => tag !== "script").join("|");
  return out
    .replace(new RegExp(`<(${tags})\\b((?:[^>"']|"[^"]*"|'[^']*')*)>`, "gi"), (whole, tag, attrs) => `<${tag}${rewriteAttributes(attrs, LOADING_TAGS[tag.toLowerCase()], move)}>`)
    .replace(/\u0000(\d+)\u0000/g, (whole, i) => kept[Number(i)]);
}

/** A tag's attributes with those in `names` moved by `move`: one address, or (srcset) each address of a list. */
function rewriteAttributes(attrs, names, move) {
  return attrs.replace(new RegExp(`(\\s(${names.join("|")})\\s*=\\s*)("([^"]*)"|'([^']*)')`, "gi"), (whole, lead, name, quoted, double, single) => {
    const quote = quoted[0];
    const value = double ?? single;
    // "a.webp 1x, b.webp 2x": each address is followed by its size. A data: address may hold commas, and names no file.
    const moved = !LISTS.has(name.toLowerCase())
      ? move(value)
      : /data:/i.test(value)
        ? value
        : value.replace(/([^\s,]+)(\s+[^,]*)?(,|$)/g, (part, ref, size = "", end) => `${move(ref)}${size}${end}`);
    return `${lead}${quote}${moved}${quote}`;
  });
}

/** An import map with its addresses moved: the names (what modules import by) stay. */
function rewriteImportMap(body, move) {
  const map = JSON.parse(body);
  const moved = (entries) => Object.fromEntries(Object.entries(entries ?? {}).map(([name, address]) => [name, typeof address === "string" ? move(address) : address]));
  if (map.imports) map.imports = moved(map.imports);
  if (map.scopes) throw new Error("a page's import map has scopes, which the build does not rewrite");
  return JSON.stringify(map);
}

/**
 * A stylesheet with every url() named where the file now is. `to(ref)` as in rewriteHtml. An
 * @import by site path without url() is refused; one by relative path still resolves beside the sheet.
 */
export function rewriteCss(css, to) {
  if (/@import\s+["']\//.test(css)) throw new Error('a stylesheet has an @import by site path, which the build does not rewrite: write @import url("...")');
  return css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s][^)\s]*))\s*\)/g, (whole, double, single, bare) => {
    const ref = double ?? single ?? bare;
    const [path, rest] = split(ref);
    const moved = path ? to(path) : null;
    return moved === null ? whole : whole.replace(ref, () => moved + rest);
  });
}

/**
 * A module with every import by site path ("/x/y.js") turned into the same file by relative
 * path, so it resolves beside the module wherever the tree is served from. Read with a real lexer,
 * so a string or a comment that looks like an import is left alone. `has(path)` says whether the
 * site path is a file of the tree: an import of anything else is left as written.
 */
export function rewriteSpecifiers(code, from, has) {
  let imports;
  try {
    [imports] = parseModule(code, from);
  } catch (err) {
    throw new Error(`Cannot read the imports of ${from}: ${err.message}`);
  }
  let out = "";
  let at = 0;
  for (const record of imports) {
    const name = record.type === "import-meta" || record.glob === true ? null : record.specifier;
    if (typeof name !== "string" || !name.startsWith("/") || name.startsWith("//")) continue;
    const [path, rest] = split(name);
    const target = posix.normalize(path.slice(1));
    if (target.startsWith("..") || !has(target)) continue;
    let rel = posix.relative(posix.dirname(from), target);
    if (!rel.startsWith(".")) rel = `./${rel}`;
    // The span may hold the quotes (an import() argument) or not: the name is what is between them.
    const quoted = /^["'`]/.test(code[record.start]);
    const [start, end] = quoted ? [record.start + 1, record.end - 1] : [record.start, record.end];
    // Only a specifier written plainly (no escapes) is replaced: its text is the name itself.
    if (start < at || code.slice(start, end) !== name) continue;
    out += code.slice(at, start) + rel + rest;
    at = end;
  }
  return out + code.slice(at);
}

/** Whether `path` is `entry` or inside it (site paths; an entry is a file or a folder). */
const under = (path, entry) => path === entry || path.startsWith(`${entry.replace(/\/$/, "")}/`);

/** A site path an address can hold as it is, and `_redirects` can hold on one line. */
const PLAIN_PATH = /^[A-Za-z0-9._~@+-]+(\/[A-Za-z0-9._~@+-]+)*$/;

/**
 * The plan of a site folded into release folders, from a flat tree.
 *
 * - `tree`: the folder that holds the flat tree; `files`: the site paths in it to fold.
 * - `id`: the release's id, the name of its folder.
 * - `stable`: site paths (a file or a folder) kept at their own address as well, as real files:
 *   what something outside the pages reads there (the web app manifest and its icons).
 * - `stableMedia`: site paths of media that a page still asks for at its old address (a game
 *   whose own page names its files from the page, not from the module): each is sent on to the
 *   media by a passing redirect (302, never kept), so nothing 404s and nothing goes stale.
 * - `headers({scripts})`: the text of `_headers`, given the CSP hashes of the pages' inline
 *   scripts as they are served.
 *
 * Returns `{id, files, redirects}`: `files` are `{path, from}` (copied) or `{path, data}`
 * (written), `redirects` are `{from, to, status}`. Nothing is written (writePlan does).
 */
export function foldTree({ tree, files, id, stable = [], stableMedia = [], headers }) {
  const info = new Map();
  for (const path of files) {
    if (path === "_headers" || path === "_redirects") continue;
    if (!PLAIN_PATH.test(path)) throw new Error(`The file ${JSON.stringify(path)} has a name an address cannot hold as it is: use letters, digits, ".", "_", "-", "@" and "+"`);
    if (under(path, RELEASE_DIR) || under(path, MEDIA_DIR)) throw new Error(`The site has a file at ${path}: /${RELEASE_DIR}/ and /${MEDIA_DIR}/ are where the releases and the media go`);
    const from = join(tree, path);
    const bytes = statSync(from).size;
    info.set(path, { from, media: isMedia(path, bytes) ? mediaPath(readFileSync(from), path) : null });
  }
  const folders = new Set();
  for (const path of info.keys()) for (let dir = posix.dirname(path); dir !== "."; dir = posix.dirname(dir)) folders.add(`${dir}/`);
  const inFolder = (path) => `${RELEASE_DIR}/${id}/${path}`;
  const isStable = (path) => stable.some((entry) => under(path, entry));
  /** Where the file at site path `path` is served for good. */
  const address = (path) => `/${info.get(path).media ?? inFolder(path)}`;
  /** The new address of what `ref` in the file at `from` names, or null to leave it as written. */
  const moved = (from) => (ref) => {
    const path = sitePathOf(from, ref);
    if (path === null) return null;
    if (folders.has(path)) return `/${inFolder(path)}`;
    const file = info.get(path);
    // A page keeps its address; so does a file kept at its own address that is not media (the manifest).
    if (!file || path.endsWith(".html") || (isStable(path) && !file.media)) return null;
    return address(path);
  };

  const out = [];
  const redirects = [];
  const pages = [];
  for (const [path, { from, media }] of info) {
    if (media) {
      if (!out.some((f) => f.path === media)) out.push({ path: media, from });
      redirects.push({ from: `/${inFolder(path)}`, to: `/${media}`, status: 301 });
      if (stableMedia.some((entry) => under(path, entry))) redirects.push({ from: `/${path}`, to: `/${media}`, status: 302 });
    } else if (path.endsWith(".html")) {
      let data;
      try {
        data = Buffer.from(rewriteHtml(readFileSync(from, "utf8"), moved(path)));
      } catch (err) {
        throw new Error(`${path}: ${err.message}`);
      }
      pages.push(data.toString());
      out.push({ path, data }, { path: inFolder(path), data });
    } else if (path.endsWith(".css")) {
      try {
        out.push({ path: inFolder(path), data: Buffer.from(rewriteCss(readFileSync(from, "utf8"), moved(path))) });
      } catch (err) {
        throw new Error(`${path}: ${err.message}`);
      }
    } else if (path.endsWith(".js") || path.endsWith(".mjs")) {
      const code = readFileSync(from, "utf8");
      const next = rewriteSpecifiers(code, path, (target) => info.has(target));
      out.push(next === code ? { path: inFolder(path), from } : { path: inFolder(path), data: Buffer.from(next) });
    } else {
      out.push({ path: inFolder(path), from });
    }
    if (isStable(path)) out.push({ path, from });
  }
  out.push({ path: "_headers", data: Buffer.from(headers({ scripts: inlineScriptHashesOf(pages) })) });
  return { id, files: out, redirects };
}

/** The `_redirects` file for `redirects` ({from, to, status}), the lasting ones first; refuses more than Workers reads. */
export function redirectsFile(redirects) {
  if (redirects.length > MAX_STATIC_REDIRECTS) {
    throw new Error(
      `The site needs ${redirects.length} redirects and Workers reads at most 2,000 (one for each media file of each release it holds): carry fewer releases, or name more media straight from pages and stylesheets`,
    );
  }
  const lines = [...redirects].sort((a, b) => b.status - a.status || (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)).map((r) => `${r.from} ${r.to} ${r.status}`);
  const long = lines.find((line) => line.length > MAX_REDIRECT_LINE || /\s/.test(line.replace(/ /g, "")) || line.split(" ").length !== 3);
  if (long) throw new Error(`Not a redirect Workers reads (one line, three parts, under 1,000 characters): ${long.slice(0, 200)}`);
  return ["# Written by the build (party-kit/build/folders.mjs): do not edit.", ...lines, ""].join("\n");
}

/** Every file under `dir`, as paths relative to it with "/" between the parts. */
function walk(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    return d.isDirectory() ? walk(p, base) : d.isFile() ? [relative(base, p).split(sep).join("/")] : [];
  });
}

/**
 * How the built site in `dir` (a build's public folder) holds release `id`: "folders" when it has
 * that release's folder, "flat" when it was built before there were folders (every file at its own
 * address). A folded build of another release is refused: it is not the build that was asked for.
 */
export function layoutOf(dir, id) {
  if (existsSync(join(dir, RELEASE_DIR, id))) return "folders";
  if (existsSync(join(dir, RELEASE_DIR)) || existsSync(join(dir, MEDIA_DIR))) throw new Error(`The build in ${dir} holds release folders, but none for ${id}: it is not that release's build`);
  return "flat";
}

/**
 * What a later deploy carries of the release `id` built in `dir`, for the pages still open on it:
 * `{id, layout, files: [{path, from}], redirects}`.
 * - A folded build: its folder, the media, and the redirects out of its folder. Nothing else: the
 *   pages and whatever else sits at its own address belong to the live release.
 * - A flat build (before there were folders): every file at its old address but the pages, which
 *   are always the live release's. Its open pages load their code and media by those addresses.
 */
export function carriedFrom(dir, id) {
  const layout = layoutOf(dir, id);
  const all = walk(dir);
  if (layout === "flat") {
    const files = all.filter((path) => !path.endsWith(".html") && path !== "_headers" && path !== "_redirects").map((path) => ({ path, from: join(dir, path) }));
    return { id, layout, files, redirects: [] };
  }
  const files = all.filter((path) => under(path, `${RELEASE_DIR}/${id}`) || under(path, MEDIA_DIR)).map((path) => ({ path, from: join(dir, path) }));
  const redirects = [];
  if (existsSync(join(dir, "_redirects"))) {
    for (const line of readFileSync(join(dir, "_redirects"), "utf8").split("\n")) {
      const [from, to, status] = line.trim().split(/\s+/);
      if (from?.startsWith(`/${RELEASE_DIR}/${id}/`) && to && status) redirects.push({ from, to, status: Number(status) });
    }
  }
  return { id, layout, files, redirects };
}

/**
 * `plan` with the releases in `carried` (carriedFrom) beside it. The build's own files and
 * redirects always win: a carried file is added only at an address the build does not serve
 * itself, by a file or by a redirect (Workers follows a redirect whatever file is there).
 */
export function withCarried(plan, carried) {
  const files = [...plan.files];
  const redirects = [...plan.redirects];
  const taken = new Set([...files.map((f) => f.path), "_redirects"]);
  const sent = new Set(redirects.map((r) => r.from));
  for (const release of carried) {
    if (release.id === plan.id) throw new Error(`The release ${plan.id} cannot carry itself`);
    for (const file of release.files) {
      if (taken.has(file.path) || sent.has(`/${file.path}`)) continue;
      taken.add(file.path);
      files.push(file);
    }
    for (const redirect of release.redirects) {
      if (sent.has(redirect.from) || taken.has(redirect.from.slice(1))) continue;
      sent.add(redirect.from);
      redirects.push(redirect);
    }
  }
  return { ...plan, files, redirects };
}

/** A plan's files with its `_redirects` among them: everything it puts in a folder, as `{path, from}` or `{path, data}`. */
export function planFiles(plan) {
  return [...plan.files, { path: "_redirects", data: Buffer.from(redirectsFile(plan.redirects)) }];
}

/**
 * Empties `out` and writes the plan into it, `_redirects` included. Returns every file written as
 * `{path, bytes}`, sorted by path.
 */
export function writePlan(out, plan) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const written = [];
  for (const file of planFiles(plan)) {
    const to = join(out, file.path);
    mkdirSync(dirname(to), { recursive: true });
    if (file.data !== undefined) writeFileSync(to, file.data);
    else cpSync(file.from, to);
    written.push({ path: file.path, bytes: statSync(to).size });
  }
  return written.sort((a, b) => a.path.localeCompare(b.path));
}
