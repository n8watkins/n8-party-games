// Makes the emotes and sounds preview as one self-contained page, for the owner to open on his
// phone, and as a small local site at /preview/emotes/ (built only with --preview, never for
// production: scripts/build-public.mjs).
//
//   node preview/make-emotes-artifact.mjs     writes preview/emotes-artifact.html
//
// The page is preview/emotes/page.html (title, styles, markup) and preview/emotes/preview.js.
// The kit's own sound engine (party-kit/client/sound-recipes.js and sounds.js) is inlined into
// it, so every sound in the preview is exactly the one the room would play.
//
// The artifact has no doctype, <html>, <head> or <body> (its host wraps it). The local site
// wraps it in a document of its own and moves the styles and the script into files, because the
// site's Content-Security-Policy allows no inline style or script.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

/** The page in its parts: {title, style, markup, script}. */
export function parts() {
  const page = read("preview/emotes/page.html");
  const title = /<title>[\s\S]*?<\/title>/.exec(page)[0];
  const style = /<style>([\s\S]*?)<\/style>/.exec(page)[1];
  const markup = page.replace(title, "").replace(/<style>[\s\S]*?<\/style>/, "").trim();
  const kit = `${plain("party-kit/client/sound-recipes.js")}\n${plain("party-kit/client/sounds.js")}`;
  const script = [
    "// The party kit's sound engine, as the room ships it (party-kit/client/sound-recipes.js, sounds.js).",
    `const { SoundBoard } = (() => {\n${kit}\nreturn { SoundBoard };\n})();`,
    "// The preview itself (preview/emotes/preview.js).",
    `(() => {\n${read("preview/emotes/preview.js")}\n})();`,
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
  const out = join(HERE, "emotes-artifact.html");
  const html = artifact();
  writeFileSync(out, html);
  console.log(`${out}: ${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB`);
}
