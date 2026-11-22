// The room fills the screen: on every phone and screen the room supports, in every look and room,
// what a device shows of the room stays inside the part of it that is drawn as room (its reach,
// lobby/public/reach.js), so no screen shows past the room's art into darkness. The pictures
// themselves are checked by lobby/test/shoot-fill.mjs.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PHONE_FRAME, camera } from "../shared/camera.js";
import { REACH, withinReach } from "../public/reach.js";
import { CAM, D_WALL, SPACE, wallX } from "../public/look3d/space.js";

const plate = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const rectReach = ({ rect }) => ({ left: rect.x0, right: rect.x1 });
/** Every drawing and its reach: the flat and 3D looks' own, and each rendered picture's rect (room-rendered.js, room-baked.js). */
const LOOKS = {
  flat: REACH.flat,
  "3d (every room)": REACH["3d"],
  "real bar": rectReach(plate("../public/look3d/rendered/bar/layers/plate.json")),
  "real star lounge": rectReach(plate("../public/look3d/rendered/star-lounge/layers/plate.json")),
  "baked bar": rectReach(plate("../public/baked/bar/5/plate.json")),
};
/** The sizes the room is checked at (sideways phones, narrow to very wide, and big screens). */
const LISTED = [
  [667, 375],
  [844, 390],
  [915, 412],
  [932, 430],
  [1280, 720],
  [1920, 1080],
];
/** And more: small and very wide phones, phones with the browser's bars showing, an upright phone, wide desktop screens. */
const MORE = [
  [568, 320],
  [667, 320],
  [740, 360],
  [800, 360],
  [844, 340],
  [900, 320],
  [932, 380],
  [1000, 400],
  [390, 844],
  [1366, 768],
  [2560, 1080],
  [3440, 1440],
];
const isPhone = ([w, h]) => Math.min(w, h) < 520;
/** The bottom strip: a phone's buttons (64 px and their padding), a big screen's line. */
const barOf = (size) => (isPhone(size) ? 70 : 56);
const views = (sizes) =>
  sizes.flatMap(([w, h]) =>
    ["room", "closer"].flatMap((mode) => [-200, 150, 960, 1800, 2200].map((focusX) => ({ w, h, bar: barOf([w, h]), mode, focusX, phone: isPhone([w, h]), boxes: 5 }))),
  );
const inside = (v, reach) => v.x >= reach.left - 1e-6 && v.x + v.width <= reach.right + 1e-6;
const show = (o, v) => `${o.w}x${o.h} ${o.mode} at ${o.focusX}: ${v.x.toFixed(0)} to ${(v.x + v.width).toFixed(0)}`;

describe("how far the room is drawn", () => {
  it("is room, in every look, at least as far as a sideways phone's whole room reaches at the listed sizes", () => {
    for (const [look, reach] of Object.entries(LOOKS)) {
      for (const o of views(LISTED)) {
        const v = withinReach(camera(o), reach, o.bar, o.h);
        expect(inside(v, reach), `${look}: ${show(o, v)}`).toBe(true);
        // And not by drawing the room smaller or cutting it: at these sizes the view is only ever slid, never brought in.
        expect(v.width, `${look}: ${show(o, v)}`).toBeCloseTo(camera(o).width, 6);
      }
    }
  });

  it("needs no sliding at all in the flat, 3D and real bar looks at the listed sizes: the framing is the camera's own", () => {
    for (const look of ["flat", "3d (every room)", "real bar"])
      for (const o of views(LISTED)) {
        const v = camera(o);
        expect(inside(v, LOOKS[look]), `${look}: ${show(o, v)}`).toBe(true);
      }
  });

  it("keeps every view inside the reach on any screen, bringing a wider one in with the pools still on the bar", () => {
    for (const [look, reach] of Object.entries(LOOKS)) {
      for (const o of views([...LISTED, ...MORE])) {
        const before = camera(o);
        const v = withinReach(before, reach, o.bar, o.h);
        expect(inside(v, reach), `${look}: ${show(o, v)}`).toBe(true);
        const open = Math.max(1, o.h - o.bar);
        // The line the room stands on the bar is where the camera put it (the pools and the feet stay on screen).
        expect(v.y + open / v.scale, `${look}: ${show(o, v)}`).toBeCloseTo(before.y + open / before.scale, 6);
        expect(v.width * v.scale).toBeCloseTo(o.w, 6);
        expect(v.height * v.scale).toBeCloseTo(o.h, 6);
      }
    }
  });

  it("keeps a sideways phone's whole room from the lamps to the pools wherever it does not need bringing in", () => {
    for (const [look, reach] of Object.entries(LOOKS))
      for (const o of views([...LISTED, ...MORE]).filter((o) => o.phone && o.w > o.h && o.mode === "room")) {
        const v = withinReach(camera(o), reach, o.bar, o.h);
        if (v.width < camera(o).width) continue;
        expect(v.y, `${look}: ${show(o, v)}`).toBeLessThanOrEqual(PHONE_FRAME.top + 1e-6);
      }
  });

  it("returns a view already inside as it is, and slides one that only pokes out", () => {
    const reach = { left: -100, right: 2100 };
    const v = { x: 0, y: 30, width: 1900, height: 900, scale: 0.4 };
    expect(withinReach(v, reach, 70, 360)).toBe(v);
    expect(withinReach(v, null)).toBe(v);
    expect(withinReach({ ...v, x: 400 }, reach, 70, 360)).toMatchObject({ x: 200, width: 1900, scale: 0.4 });
    // Wider than the reach: with `slide` it is set in the middle, never brought in.
    const wide = { x: -500, y: 30, width: 2600, height: 900, scale: 0.4 };
    expect(withinReach(wide, reach, 70, 360, { slide: true })).toMatchObject({ x: -300, width: 2600, scale: 0.4 });
    expect(withinReach(wide, reach, 70, 360).width).toBeCloseTo(2200, 6);
  });

  it("runs the 3D look's end walls far enough toward the viewer that a view to its reach sees end wall, not past it", () => {
    // The end walls run from the back wall to the front of the floor (look3d/room3d.js, shell): the
    // edge of a view at the reach, followed from the camera, meets x = SPACE.w / 2 before that front.
    const front = SPACE.zFront + (SPACE.zFront - SPACE.zBack);
    for (const edge of [REACH["3d"].left, REACH["3d"].right]) {
      const across = Math.abs(wallX(edge)) * ((CAM.z - front) / D_WALL);
      expect(across, `the view's edge at ${edge} passes the front of the end wall`).toBeLessThanOrEqual(SPACE.w / 2);
    }
  });
});
