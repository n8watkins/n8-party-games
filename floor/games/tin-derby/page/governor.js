// Tin Derby: how sharp the picture is drawn, from how quickly frames come. Plain arithmetic, no browser: a page feeds
// it each frame's interval and it says when to draw fewer pixels (-1) or more (+1).
//
// Cork & Bell's rule, with these changes:
// - A frame is slow when it is late against the display's own frame interval, taken as the median of the last
//   WINDOW intervals (so one short interval, or the few milliseconds of jitter some browsers put on frame times,
//   does not move it), and never longer than a 50 Hz frame (so a page stuck at 30 frames a second all along still
//   counts as slow).
// - Forty slow frames in a row lower the resolution; RECOVER frames in a row that are not slow (ten seconds at 60 Hz)
//   raise it again. Before, raising needed frames under 12.5 ms, which a 60 Hz screen never draws.
// - A screen crawling at a few frames a second (drawing in software) would take half a minute to show forty slow
//   frames in a row, so three frames in a row of at least CRAWL_MS also count. One long frame (a stall, a picture's
//   first frame) followed by ordinary ones does not.

/** Frames this slow, three in a row, lower the resolution at once. */
export const CRAWL_MS = 250;
/** How many recent frame intervals the display's own interval is the median of. */
export const WINDOW = 61;
/** Frames in a row that are not slow before the resolution goes up again. */
export const RECOVER = 600;

/**
 * @param {{slowMs: number}} limits  slow: longer than this, and than half again the display's interval
 */
export function makeGovernor({ slowMs }) {
  let slow = 0, ok = 0, crawl = 0;
  const recent = [];
  const display = () => {
    if (!recent.length) return 16.7;
    const s = [...recent].sort((a, b) => a - b);
    return Math.min(20.1, Math.max(4, s[s.length >> 1]));
  };
  return {
    /** One frame's interval in ms. Returns -1 (draw fewer pixels), +1 (more) or 0. */
    frame(ms) {
      if (!(ms > 0)) return 0;
      recent.push(ms);
      if (recent.length > WINDOW) recent.shift();
      const isSlow = ms > Math.max(slowMs, display() * 1.5);
      crawl = ms >= CRAWL_MS ? crawl + 1 : 0;
      if (isSlow) { slow++; ok = 0; } else { slow = 0; ok++; }
      if (slow >= 40 || crawl >= 3) { slow = 0; crawl = 0; return -1; }
      if (ok >= RECOVER) { ok = 0; return 1; }
      return 0;
    },
  };
}
