// The stage: the ghost doing an emote at a pawn, drawn the way the room draws it.
//
// The bodies and the hands are 3D (three.js, as the room's 3D look); the props, the effects, what
// happens at the target and the word over the head are the room's own SVG (lobby/public/emotes/
// svg.js), laid over the picture from the same pose. One scene is drawn into up to two pictures:
// the main one (large, or at the exact size of a piece on a TV or a phone) and, where there is
// room beside it, a second one at phone size.
import * as T from "three";
import { EmoteFigure, Sticker } from "../../../lobby/public/emotes/svg.js";
import { s as svgEl } from "../../../lobby/public/dom.js";
import { PAWN_METRES, PX, RIG_TO_ROOM, RIG_UNIT, SIZE, WALK_Z, buildRoom, makeGhost, makePawn, palette } from "./bodies.js";
import { GhostLimbs } from "./ghost-limbs.js";
import { ghostPoseTop, ghostRigById } from "./ghost-rig.js";

/** How far away the target stands, in rig units (the room allows 90 to 420). */
export const REACH = 170;
/** How tall a pawn is on a phone held sideways in the room, and on a TV, in CSS pixels (the character previews' numbers). */
export const REAL = { phone: 72, tv: 141 };
/** A pause between two runs of the same emote. */
const GAP_MS = 900;
/** What a picture must show, in metres from the ghost (left, top) and from the pawn (right), and under the floor line. */
const BOX = { left: 0.62, right: 0.36, top: 1.75, under: 0.1 };
/** How high the pawn's head reaches, in metres, with a little air over it. */
const PAWN_TOP = PAWN_METRES + 0.05;
/** The strip along the bottom of the stage where its buttons sit. */
const STRIP = 54;
const CAM_Y = 4.2;
const CAM_Z = 17.5;

const HALF = (REACH * RIG_TO_ROOM) / 2;
const GHOST_X = -HALF;
const PAWN_X = HALF;
const SPAN = { x0: GHOST_X * PX - BOX.left, x1: PAWN_X * PX + BOX.right };
const SPAN_W = SPAN.x1 - SPAN.x0;
const SPAN_H = BOX.top + BOX.under;

export function createStage({ box, canvas, overlay, inset, onNoGl }) {
  let renderer = null;
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  } catch {
    renderer = null;
  }
  if (!renderer) {
    onNoGl();
    return null;
  }
  renderer.autoClear = false;
  const scene = new T.Scene();
  scene.background = new T.Color(0x1a110c);
  scene.add(new T.HemisphereLight(0xfff1dc, 0x3a261a, 1.5));
  const key = new T.DirectionalLight(0xfff4e6, 2.3);
  key.position.set(-3.5, 7, 9);
  scene.add(key);
  const fill = new T.DirectionalLight(0xffd9a8, 0.7);
  fill.position.set(5, 3, 4);
  scene.add(fill);
  buildRoom(scene);
  const ghost = makeGhost(scene);
  const pawn = makePawn(scene);
  const limbs = new GhostLimbs(ghost);
  const G = { x: GHOST_X, face: 1, fade: false, lit: 1, seat: 0, emote: null };
  const P = { x: PAWN_X, face: -1, seat: 1, flinch: 0 };

  // ---- the pictures: each has a camera, a place on the stage and its own layer of SVG
  function makeView(name) {
    const svg = svgEl("svg", { class: "over", "data-view": name });
    overlay.append(svg);
    const figure = new EmoteFigure("#ffffff", { face: false, limbs: false });
    const words = svgEl("g", {});
    svg.append(figure.stage, figure.body, words);
    return { name, cam: new T.PerspectiveCamera(10, 1, 1, 60), rect: null, ppm: 0, svg, figure, sticker: new Sticker(words) };
  }
  const main = makeView("main");
  const side = makeView("inset");
  const views = [main, side];
  let mode = "large";

  /** Points a camera so `ppm` pixels are a metre at the walking line, x = cx is the middle and the floor is `floorUp` pixels above the picture's foot. The camera never turns. */
  function aim(view, w, h, ppm, cx, floorUp) {
    const viewH = h / ppm;
    const yc = viewH * (0.5 - floorUp / h);
    const dist = Math.hypot(CAM_Y - yc, CAM_Z - WALK_Z);
    const c = view.cam;
    c.aspect = w / h;
    c.fov = (2 * Math.atan(viewH / 2 / dist) * 180) / Math.PI;
    c.position.set(cx, CAM_Y, CAM_Z);
    c.lookAt(cx, yc, WALK_Z);
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
    view.ppm = ppm;
  }

  let W = 1;
  let H = 1;
  function fit() {
    W = Math.max(1, box.clientWidth);
    H = Math.max(1, box.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    const phonePpm = REAL.phone / PAWN_METRES;
    const tvPpm = REAL.tv / PAWN_METRES;
    const iw = Math.ceil(SPAN_W * phonePpm);
    const ih = Math.ceil(SPAN_H * phonePpm);
    // Where the large picture's subject may sit: the stage, less the strip of buttons, less the phone-size picture when it fits.
    const area = { x: 0, y: 0, w: W, h: H - STRIP };
    let place = null;
    let ppm = mode === "tv" ? tvPpm : mode === "phone" ? phonePpm : Math.min(area.w / SPAN_W, area.h / SPAN_H, 340);
    if (mode === "large") {
      // The phone-size picture goes in the corner over the pawn's head, where nothing happens. The large
      // picture is made a little smaller if that is what it takes to keep the pawn clear of it; when it
      // would have to shrink close to phone size itself, there is no second picture (the buttons switch).
      const need = ih + 32;
      const fits = (H - STRIP - need) / (BOX.under + PAWN_TOP);
      const p = Math.min(ppm, fits);
      if (p >= phonePpm * 1.45 && W >= iw + 150) {
        ppm = p;
        place = { x: W - iw - 8, y: 8 };
      }
    }
    // The subject's middle goes to the area's middle; the floor line sits just above the strip.
    const cx = (SPAN.x0 + SPAN.x1) / 2 - (area.x + area.w / 2 - W / 2) / ppm;
    main.rect = { x: 0, y: 0, w: W, h: H };
    aim(main, W, H, ppm, cx, STRIP + BOX.under * ppm);
    side.rect = place ? { x: place.x, y: place.y, w: iw, h: ih } : null;
    if (place) aim(side, iw, ih, phonePpm, (SPAN.x0 + SPAN.x1) / 2, BOX.under * phonePpm);
    inset.hidden = !place;
    if (place) Object.assign(inset.style, { left: `${place.x}px`, top: `${place.y}px`, width: `${iw}px`, height: `${ih}px` });
    for (const v of views) {
      v.svg.style.display = v.rect ? "" : "none";
      if (v.rect) Object.assign(v.svg.style, { left: `${v.rect.x}px`, top: `${v.rect.y}px`, width: `${v.rect.w}px`, height: `${v.rect.h}px` });
    }
    box.dataset.size = mode === "large" ? (place ? "large+phone" : "large") : mode;
    box.dataset.ppm = ppm.toFixed(1);
  }

  // ---- what is playing
  const playing = { rig: null, take: "float", at: 0, frozen: null };
  let now = 0;
  function play(id, take) {
    const rig = ghostRigById(id);
    if (!rig) return;
    playing.rig = rig;
    playing.take = rig.takes.includes(take) ? take : rig.takes[0];
    playing.at = now;
    playing.frozen = null;
  }

  const v3 = new T.Vector3();
  function project(view, x, y, z) {
    v3.set(x, y, z).project(view.cam);
    return [((v3.x + 1) / 2) * view.rect.w, ((1 - v3.y) / 2) * view.rect.h];
  }

  function step(dt) {
    let pose = null;
    let t = 0;
    const rig = playing.rig;
    if (rig) {
      t = playing.frozen ?? (now - playing.at) % (rig.dur + GAP_MS);
      if (t < rig.dur) pose = rig.pose(t, false, REACH, playing.take);
    }
    G.emote = pose;
    P.flinch = pose ? pose.other.flinch : 0;
    ghost.update(G, now, dt);
    pawn.update(P, now);
    limbs.set(pose, now);
    ghost.group.updateMatrixWorld(true);

    const sticker = pose && t > 250 && t < rig.dur - 250;
    const pop = sticker ? Math.min(1, (t - 250) / 160) : 0;
    const gp = ghost.group.position;
    const spin = (-ghost.tilt.rotation.z * 180) / Math.PI;
    const m = RIG_UNIT * SIZE;
    for (const v of views) {
      if (!v.rect) continue;
      v.figure.body.style.display = v.figure.stage.style.display = pose ? "" : "none";
      if (!pose) {
        v.sticker.show(null);
        continue;
      }
      const [x0, y0] = project(v, gp.x, gp.y, gp.z);
      const [x1] = project(v, gp.x + m, gp.y, gp.z);
      const [, y1] = project(v, gp.x, gp.y + m, gp.z);
      const kx = x1 - x0;
      const ky = y0 - y1;
      const [fx, fy] = project(v, G.x * PX, 0, WALK_Z);
      v.figure.body.setAttribute("transform", `translate(${x0.toFixed(1)},${y0.toFixed(1)}) rotate(${spin.toFixed(2)}) scale(${kx.toFixed(4)},${ky.toFixed(4)})`);
      v.figure.stage.setAttribute("transform", `translate(${fx.toFixed(1)},${fy.toFixed(1)}) scale(${kx.toFixed(4)},${ky.toFixed(4)})`);
      v.figure.draw(pose, REACH);
      // The word: over whatever the emote holds up, sized as the room sizes it (never too small to read).
      // At TV and phone size that is the room's own formula; the large picture is no real size, so its word is held to a sensible one.
      const real = Math.max(0.62, (kx / RIG_TO_ROOM) * 1.25);
      let scale = v === main && mode === "large" ? Math.min(real, 1.1) : real;
      // Kept inside its picture, and clear of the phone-size picture beside it.
      let half =(Math.max(60, [...rig.word].length * 12.5 + 28) / 2 + 12) * scale;
      const y = Math.max(y0 + ghostPoseTop(pose) * ky, 60 * scale + 4);
      const right = v === main && side.rect && y - 60 * scale < side.rect.y + side.rect.h ? side.rect.x - 4 : v.rect.w;
      // When the room beside the phone-size picture is too narrow for the word, the word shrinks to fit.
      const fitK = Math.min(1, (right - 4) / (2 * half));
      scale *= fitK;
      half *= fitK;
      const x =Math.max(half + 2, Math.min(right - half - 2, x0));
      v.sticker.show(sticker ? rig.word : null, x, y, scale, pop);
    }
  }

  function render() {
    const dpr = renderer.getPixelRatio();
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    for (const v of views) {
      if (!v.rect) continue;
      const r = v.rect;
      renderer.setViewport(r.x, H - r.y - r.h, r.w, r.h);
      renderer.setScissor(r.x, H - r.y - r.h, r.w, r.h);
      renderer.clear(false, true, false);
      renderer.render(scene, v.cam);
    }
    void dpr;
  }

  // ---- the loop: runs only while the page is showing
  let raf = 0;
  let last = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
    last = ts;
    now += dt * 1000;
    step(dt);
    render();
  }
  function run(on) {
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    if (on) raf = requestAnimationFrame(frame);
  }
  document.addEventListener("visibilitychange", () => run(!document.hidden));
  new ResizeObserver(() => {
    fit();
    step(0);
    render();
  }).observe(box);

  ghost.tint(palette("#2f6f8f"));
  pawn.tint(palette("#d9a02a"));
  fit();
  run(!document.hidden);

  return {
    play,
    get playing() {
      return playing.rig ? { id: playing.rig.id, take: playing.take } : null;
    },
    setColours(ghostHex, pawnHex) {
      ghost.tint(palette(ghostHex));
      pawn.tint(palette(pawnHex));
    },
    setFaded(on) {
      G.fade = !!on;
    },
    setMode(m) {
      mode = m;
      fit();
    },
    /** For checks: holds an emote at one moment (ms), lets the body settle, and draws it. */
    freeze(id, take, ms) {
      play(id, take);
      playing.frozen = ms;
      for (let i = 0; i < 90; i++) {
        now += 1000 / 60;
        step(1 / 60);
      }
      render();
    },
    /** For checks: back to running. */
    thaw() {
      playing.frozen = null;
      playing.at = now;
    },
  };
}
