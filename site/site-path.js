// Where this page's own files are served from, and the address of a file named by its site path.
//
// A release's files are served from the release's own folder (/r/<release id>/, kept by the
// browser for a year: party-kit/build/folders.mjs), so a page must never name a file by site path
// ("/art/x.webp"): that address is outside the folder. A module names its own files beside itself
// (new URL("./x.webp", import.meta.url)). The room, though, names a game's view and a game's
// picture by site path (lobby/wall.js), as it must: it does not know which release a page is.
// siteUrl turns such a path into the file's address in this page's own release.
//
// This file is served at the root of the site's files, so the folder it is in is that root: "/"
// for a site without folders, the release's folder otherwise.
const ROOT = new URL("./", import.meta.url);

/**
 * The address of the file at site path `path` ("/cork-and-bell/game/party-view.js") in this
 * page's release. Always on this site for a path: leading slashes (and backslashes, which a
 * browser reads as slashes) are taken off, so "//other.example/x" is a path here, not a host. A
 * full address ("https://...") keeps its own origin: a caller that loads code checks the origin.
 */
export function siteUrl(path, root = ROOT) {
  return new URL(String(path).replace(/^[/\\]+/, ""), root);
}
