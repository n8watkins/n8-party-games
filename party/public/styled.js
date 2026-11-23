// A game's view at the Table brings its own stylesheet (a <link> it puts in its box): until that
// has loaded, the view is kept out of sight, so nobody sees (or taps) its buttons unstyled for a
// moment, as happened after a reload on a slow connection (stage.js). Its own module, with no
// imports, so party/test/styled.test.js can drive it.

/** The longest a view is kept out of sight while its stylesheet loads: then it shows, styled or not. */
export const STYLE_WAIT_MS = 4000;

/**
 * Hides `box` until every stylesheet link in it has loaded. A sheet that fails to load shows the
 * view anyway, and so does one that has neither loaded nor failed after `waitMs` (a stalled
 * connection must never leave a game unseen and unplayable). Returns a function that shows the box
 * at once and stops waiting (the stage calls it when the view goes). `timers` stands in for the
 * browser's in the tests.
 */
export function hideUntilStyled(box, { timers = globalThis, waitMs = STYLE_WAIT_MS } = {}) {
  // Whatever an earlier view of this box left (it went before its sheet loaded), this one starts seen.
  box.style.visibility = "";
  const pending = [...box.querySelectorAll('link[rel="stylesheet"]')].filter((link) => !link.sheet);
  if (!pending.length) return () => {};
  box.style.visibility = "hidden";
  let left = pending.length;
  let shown = false;
  const show = () => {
    if (shown) return;
    shown = true;
    timers.clearTimeout(limit);
    box.style.visibility = "";
  };
  const limit = timers.setTimeout(show, waitMs);
  const done = () => {
    left -= 1;
    if (left === 0) show();
  };
  for (const link of pending) {
    link.addEventListener("load", done, { once: true });
    link.addEventListener("error", done, { once: true });
  }
  return show;
}
