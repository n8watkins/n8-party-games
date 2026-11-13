// Makes the emotes preview (fourth round) as one self-contained page for the owner to open on his
// phone, and as a small local site at /preview/emotes/ (built only with --preview, never for
// production: scripts/build-public.mjs).
//
//   node preview/make-emotes-artifact.mjs     writes preview/emotes-artifact-v4.html
//
// The page is preview/emotes/page.html (title, styles, markup) and three scripts: rig.js (what
// every emote does, as data a 3D drawing could also read), draw.js (the flat SVG drawing of it)
// and preview.js (the page around them).
// Inlined into it: the kit's sound player (party-kit/client/sounds.js), so the preview plays
// sounds exactly as the room would, and the recordings in preview/sounds/ (made by
// preview/recordings/process.mjs, each a CC0 recording with where it came from) as data: URIs.
// The recordings and the page that embeds them are not committed until the owner picks; without
// them the page still works, silently.
//
// The first round is preview/emotes-artifact.html, kept as it was shown; the second and third
// rounds' sources are in the history (commits b972c4d and bab49df), published from there.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

/** A module of the kit as plain script: no imports, nothing exported. */
const plain = (path) =>
  read(path)
    .replace(/^import .*;$/gm, "")
    .replace(/^export /gm, "");

/** The recordings, each with a data: URI, or none when they have not been made on this machine. */
function clips() {
  const list = join(HERE, "sounds", "sounds.json");
  if (!existsSync(list)) return [];
  return JSON.parse(readFileSync(list, "utf8")).map((c) => ({ ...c, uri: "data:audio/mpeg;base64," + readFileSync(join(HERE, "sounds", c.file)).toString("base64") }));
}

/** The page in its parts: {title, style, markup, script}. */
export function parts() {
  const page = read("preview/emotes/page.html");
  const title = /<title>[\s\S]*?<\/title>/.exec(page)[0];
  const style = /<style>([\s\S]*?)<\/style>/.exec(page)[1];
  const markup = page.replace(title, "").replace(/<style>[\s\S]*?<\/style>/, "").trim();
  const script = [
    "// The party kit's player for emotes' sounds, as the room ships it (party-kit/client/sounds.js).",
    `const { SoundBoard, defineSound } = (() => {\n${plain("party-kit/client/sounds.js")}\nreturn { SoundBoard, defineSound };\n})();`,
    "// The recordings: CC0, from the pages named in each entry.",
    `const CLIPS = ${JSON.stringify(clips())};`,
    "// The preview itself: the rig (preview/emotes/rig.js), its drawing (draw.js) and the page (preview.js).",
    `(() => {\n${read("preview/emotes/rig.js")}\n${read("preview/emotes/draw.js")}\n${read("preview/emotes/preview.js")}\n})();`,
  ].join("\n");
  return { title, style, markup, script };
}

/** One file, everything inline. */
export function artifact() {
  const { title, style, markup, script } = parts();
  return `${title}\n<style>${style}</style>\n${markup}\n<script>\n${script}\n</script>\n`;
}

/** The same page as a small site in `dir`: index.html, preview.css and preview.js. */
export function writeSite(dir) {
  const { title, style, markup, script } = parts();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "preview.css"), style);
  writeFileSync(join(dir, "preview.js"), script);
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n<meta name="robots" content="noindex" />\n${title}\n<link rel="stylesheet" href="preview.css" />\n</head>\n<body>\n${markup}\n<script src="preview.js"></script>\n</body>\n</html>\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = join(HERE, "emotes-artifact-v4.html");
  const html = artifact();
  writeFileSync(out, html);
  console.log(`${out}: ${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB, ${clips().length} recordings`);
}
