// Stills: pictures the end-to-end scripts take for people to look at, never a check. A still is
// best-effort: one that cannot be taken in a moment (the page is navigating away, the machine is
// busy, the browser is drawing in software) is skipped with a line saying so, and the run goes
// on. A script that needs what a page drew reads it in a check of its own, not from a still.
import { basename } from "node:path";

/** How long a still may take before it is skipped. */
export const STILL_TIMEOUT_MS = 10_000;

/**
 * Takes a still of `target` (a page or a locator), with Playwright's screenshot options `opts`
 * (its `path` among them). Returns the picture, or null when it was skipped (and says why).
 * `leaving`: the page may be on its way to another address (a click that moves it): the still is
 * dropped the moment it navigates, rather than waiting on a page that is going.
 */
export async function still(target, { leaving = false, ...opts } = {}) {
  const what = opts.path ? basename(opts.path) : "a picture";
  let said = false;
  const skipped = (why) => {
    if (!said) console.log(`     (still skipped: ${what}: ${why})`);
    said = true;
    return null;
  };
  const taking = target.screenshot({ ...opts, timeout: Math.min(opts.timeout ?? STILL_TIMEOUT_MS, STILL_TIMEOUT_MS) }).catch((e) => skipped(String(e?.message ?? e).split("\n")[0]));
  if (!leaving) return taking;
  const page = typeof target.page === "function" ? target.page() : target;
  let left;
  const gone = new Promise((done) => {
    left = (frame) => frame === page.mainFrame() && done("gone");
    page.on("framenavigated", left);
  });
  const first = await Promise.race([taking, gone]);
  page.off("framenavigated", left);
  return first === "gone" ? skipped("the page moved on while it was taken") : first;
}
