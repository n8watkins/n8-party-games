// Tin Derby: how sharp the picture is drawn, from how quickly frames come. Plain arithmetic, no browser: a page feeds
// it each frame's interval and it says when to draw fewer pixels (-1) or more (+1).
//
// Cork & Bell's rule, with two changes:
// - Slow and fast are measured against the display's own frame interval (the shortest interval seen), so a 60 Hz
//   screen, whose frames are never under 12.5 ms, can still earn its resolution back; and a 120 Hz one is not taken
//   for fast when it is running at half its rate.
// - A screen crawling at a few frames a second (drawing in software) would take half a minute to show forty slow
//   frames in a row, so three frames in a row of at least CRAWL_MS also count. One long frame (a stall, a picture's
//   first frame) followed by ordinary ones does not.

/** Frames this slow, three in a row, lower the resolution at once. */
export const CRAWL_MS = 250;

/**
 * @param {{slowMs: number, fastMs: number}} limits  slow: at least this long (and half again the display's interval);
 *   fast: under this or within a fifth of the display's interval
 */
export function makeGovernor({ slowMs, fastMs }) {
  let slow = 0, fast = 0, crawl = 0, display = Infinity;
  return {
    /** One frame's interval in ms. Returns -1 (draw fewer pixels), +1 (more) or 0. */
    frame(ms) {
      if (!(ms > 0)) return 0;
      // The display's interval: the shortest frame seen, never under 4 ms (a doubled callback) nor over 50.
      if (ms >= 4) display = Math.min(display, Math.max(4, ms));
      const d = Math.min(display, 50);
      const isSlow = ms > Math.max(slowMs, d * 1.5), isFast = ms < Math.max(fastMs, d * 1.2);
      crawl = ms >= CRAWL_MS ? crawl + 1 : 0;
      if (isSlow) { slow++; fast = 0; } else { slow = 0; fast = isFast ? fast + 1 : 0; }
      if (slow >= 40 || crawl >= 3) { slow = 0; crawl = 0; return -1; }
      if (fast >= 600) { fast = 0; return 1; }
      return 0;
    },
  };
}
