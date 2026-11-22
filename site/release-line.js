// The one quiet line that says which build a page is: on the front page under "Made in the open",
// in the Floor's room picker and at the foot of the Table. It reads the release record the build
// wrote (/release.js, scripts/release.mjs), the same one /api/version answers with.
import { RELEASE } from "/release.js";

/** "Version 0.1.0, build 797991e34665", with "(local changes)" on a build of an uncommitted tree. */
export function releaseLine(release = RELEASE) {
  return `Version ${release.site}, build ${release.id}${release.dirty ? " (local changes)" : ""}`;
}

/** The release this page was built as. */
export { RELEASE };
