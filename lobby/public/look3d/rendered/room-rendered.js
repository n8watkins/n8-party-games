// A room made of rendered layers, as a drawing of the live party room.
//
// It is the 3D look (look3d/room3d.js) with its walls, floor, lamps and fittings swapped for the
// room's rendered picture (rendered/plate.js), and, for a room with windows, what is outside drawn
// first as a scene of its own and cut to the glass. Everything that is the room's data stays the
// 3D look's, called and not copied: the pieces and how they stand and move (look3d/pieces.js),
// name tags, the join sign with the real code and QR, the Tonight board, the signs, emotes, the
// count, the coin toss and the bump. What a rendered room adds is in its own subclass (the Star
// Lounge: rendered/star-lounge/room.js), which says:
//
//   static DEF          its entry in rendered/switch.js (name, boxes, steps)
//   loadLayers(opts)    fetches its plate and pictures: {plate, base, lights, sheet, env}
//   lightNames          the plate's lights, in uniform order (the first ones are the lamps, one per box)
//   dress(room)         builds its own things once the 3D look has built the room
//   lamp(b, i)          its lamp over box i: returns the group that swings (look3d/life.js swings it)
//   tick(now)           sets its lamps and lights for this frame, just before it is drawn
//   outside             a scene drawn first, or null; `sill` where its window starts
//   step(name, on)      takes (or undoes) one of its steps down the ladder
//
// And, where its picture is not laid out as the 3D look lays out a room (the bar is a painting):
//
//   posterAt(i, L)      where box i's poster hangs on the wall, in metres: {x, y, z, w, h}
//   posterArt(box)      the poster's picture, as a texture
//   posterShade(lit, gold)  how bright a poster is: lit is 0 (its light off) to 1, gold 0 to 1 (it leads)
//   placeWords(room)    moves the room's words (join sign, Tonight board, signs) onto its picture
//   painted             true: the picture is shown as painted (no film curve on it, its posters or its cards)
//   across              how wide its picture's wall is, in metres, if wider than the 3D look's room
//   eye                 how far the eye moves sideways as the view slides, as a share of how far the
//                       view is from the room's middle (0, the 3D look's own rule: it never moves).
//                       The walking line keeps its place on the screen, so the pieces, their tags and
//                       the pools stay exactly where the room's numbers put them; the wall behind
//                       moves less and what stands in front more, which is what reads as depth.
//   still               true: nothing shakes (a bump does not jolt the picture)
//   voteLight           the colour of the pools' light, if not the room's own
// On a device that cannot keep up it comes down its ladder (rendered/ladder.js) and at the
// bottom draws itself as the 3D look draws the room, in place, without the page swapping views.
// A wall with a different number of boxes than its picture is drawn by the 3D look as it stands.
import { Reflection } from "../characters.js";
import { boxArt } from "../paint.js";
import { Room3D } from "../room3d.js";
import { CAM, D_WALL, FRAME, PX, SPACE, U, WALK, walkX, wallX, wallY } from "../space.js";
import * as THREE from "../three.js";
import { Ladder } from "./ladder.js";
import { drawOutsideFirst, farCamera, radialTexture, shellGroup, shellMaterial, windowBox } from "./plate.js";
import { FELL_BACK_NOTE, rememberRung, rungName, rungOf } from "./switch.js";
import { LAYERS_MS, within } from "./within.js";

/** Gives back every texture in a room's layers that came too late (and one level in: the outside's pictures by name). */
function giveBack(layers) {
  const textures = new Set();
  for (const v of Object.values(layers ?? {})) {
    if (v?.isTexture) textures.add(v);
    else if (v && typeof v === "object") for (const t of Object.values(v)) if (t?.isTexture) textures.add(t);
  }
  for (const t of textures) t.dispose();
}

export class RoomRendered extends Room3D {
  /** Starts the drawing in `root`. Throws when the device cannot draw it or its layers do not arrive, so the page can open the 3D look instead. */
  static async open(root, opts) {
    const view = await super.open(root, { ...opts, skin: this.SKIN });
    // A layer stuck on a slow connection does not hold the room (dimmed while a view loads): after
    // LAYERS_MS the room is drawn the 3D look's way, and what arrives later is given back unused.
    const abort = new AbortController();
    try {
      Object.assign(view, await within(view.loadLayers(opts, abort.signal), LAYERS_MS, { onTimeout: () => abort.abort(), late: giveBack }));
    } catch (err) {
      view.destroy();
      throw err;
    }
    view.dressRoom();
    return view;
  }

  constructor(...args) {
    super(...args);
    const def = this.constructor.DEF;
    const params = new URLSearchParams(location.search);
    this.def = def;
    this.rendered = true;
    this.plain = false;
    this.fellBack = false;
    this.mirror = new THREE.Group();
    this.scene.add(this.mirror);
    this.outCam = new THREE.PerspectiveCamera();
    this.glow = radialTexture();
    this.todaySkin = this.skin;
    this.painted = false;
    this.across = SPACE.w;
    this.eye = 0;
    this.still = false;
    this.frameRing = true;
    const rung = rungOf(def, params);
    this.rung = rung;
    // The ladder is for real devices: a test that asked for software drawing (?gl=any) is slow on
    // purpose, and stays on the rung it asked for (?rung=) unless it asks for the ladder
    // (?ladder=on); a measurement holds its rung with ?ladder=off.
    const ladder = params.get("ladder") ?? (params.get("gl") === "any" ? "off" : "on");
    this.ladder = ladder === "on" ? new Ladder({ ratio: this.ratio, steps: def.steps, taken: rung.taken, capped: rung.capped }) : null;
    window.__roomRendered = this;
  }

  /** Once the layers are here: the pieces' light, and the steps already taken on this device. */
  dressRoom() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromEquirectangular(this.env).texture;
    pmrem.dispose();
    this.lightsBefore = this.scene.children.filter((o) => o.isLight).map((o) => ({ o, color: o.color.clone(), intensity: o.intensity, position: o.position.clone(), ground: o.groundColor?.clone() }));
    this.roomLights(true);
    for (const s of this.rung.taken) this.step(s, true);
  }

  /** The room's light on the pieces: the rendered room's (on), or the 3D look's three plain lights (off). */
  roomLights(on) {
    if (!on) {
      for (const l of this.lightsBefore) {
        l.o.color.copy(l.color);
        l.o.intensity = l.intensity;
        l.o.position.copy(l.position);
        if (l.ground) l.o.groundColor.copy(l.ground);
      }
      this.scene.environment = null;
      return;
    }
    const pieceLight = this.pieceLight ?? {};
    for (const o of this.scene.children) {
      if (o.isHemisphereLight && pieceLight.hemi) {
        o.intensity = pieceLight.hemi.intensity;
        o.color.set(pieceLight.hemi.sky);
        o.groundColor.set(pieceLight.hemi.ground);
      } else if (o.isDirectionalLight) {
        const d = o.position.y > 8 ? pieceLight.back : pieceLight.front;
        if (!d) continue;
        o.color.set(d.colour);
        o.intensity = d.intensity;
        o.position.set(...d.at);
      }
    }
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = pieceLight.env ?? 0.75;
  }

  // ---------------------------------------------------------------- building

  build(room) {
    this.plain = this.fellBack || room.boxes.length !== this.def.boxes;
    // Drawn the 3D look's way: its own plain lights on the pieces, and no rendered room shining in them.
    if (this.plain && this.lightsBefore) this.roomLights(false);
    // The room's life: as the 3D look has it when it draws the room, the rendered room's own otherwise.
    this.skin = this.plain ? this.todaySkin : { ...this.todaySkin, life: this.ownLife(this.todaySkin.life ?? []) };
    this.el.classList.toggle("rendered", !this.plain);
    this.scene.background = this.plain ? new THREE.Color(0x03050c) : null;
    this.renderer.autoClear = this.plain;
    this.lamps = [];
    super.build(room);
    if (!this.plain) {
      this.dress(room);
      this.placeWords?.(room);
    }
    // The eye is where the 3D look keeps it until the next picture says otherwise.
    this.camera.position.x = 0;
    this.camera.updateMatrixWorld();
    this.words.movedKey = "";
    this.wallShift = null;
    this.wallShiftWorld = 0;
  }

  /** Which of the skin's life a rendered room keeps (the rest is in its picture or its own). */
  ownLife(life) {
    return life;
  }

  shell(L) {
    if (this.plain) return super.shell(L);
    this.shellMat = shellMaterial(this.plate, this.base, this.lights, this.lightNames, { exposure: this.exposure ?? 0.95, shine: this.shine ?? 0.5 });
    // A painting is shown as it was painted: its colours are already the room's, with no film curve on top.
    this.shellMat.toneMapped = !this.painted;
    this.shellMesh = shellGroup(this.shellMat, { w: this.across });
    this.stuff.add(this.shellMesh);
    // The 3D look works its pools out in the floor's shader; here they are in the picture, and this stands in for that floor.
    this.floor = { material: { uniforms: { uPools: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 1, 0)) } } } };
    this.frameMat = new THREE.MeshBasicMaterial({ color: this.skin.frame });
    this.goldMat = new THREE.MeshBasicMaterial({ color: this.skin.accent });
  }

  doorway(L) {
    if (this.plain) super.doorway(L);
  }

  bulbs() {
    if (this.plain) super.bulbs();
  }

  /** Where box i's poster hangs, in metres: the 3D look's place for it, as the rendered picture was made for. */
  posterAt(i, L) {
    return { x: L.xs[i], y: L.by, z: SPACE.zBack + 0.36, w: L.bw, h: L.bh };
  }

  /** A box's poster as a texture: its art, as the 3D look draws it. `at` is where it hangs (posterAt). */
  posterArt(box, at) {
    const tex = new THREE.CanvasTexture(boxArt(box, this.images));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return tex;
  }

  /** How bright a poster is: `lit` 0 (its light off) to 1, `gold` 0 to 1, `level` its lamp's level (how many stand in its light). A screen that lights up. */
  posterShade(lit, gold, level) {
    return 0.34 + 0.56 * lit + 0.22 * gold;
  }

  /** One game box: its poster in the picture's frame, a gold edge and glow for the box that leads, and its lamp. */
  box(box, i, L) {
    if (this.plain) return super.box(box, i, L);
    const b = { box, i, cx: L.wall.xs[i], level: 0, aim: 0, gold: 0, goldAim: 0, shown: -1 };
    b.pool = new THREE.Vector4(walkX(b.cx), SPACE.walkZ, this.light.pool * PX, 0);
    const at = (b.at = this.posterAt(i, L));
    const g = new THREE.Group();
    g.position.set(at.x, at.y, at.z);
    b.art = new THREE.MeshBasicMaterial({ map: this.posterArt(box, at), toneMapped: !this.painted });
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(at.w, at.h), b.art));
    const [nw, nh] = [at.w + FRAME.gap * 2, at.h + FRAME.gap * 2];
    const bar = FRAME.bar * 0.6;
    b.goldFace = new THREE.MeshBasicMaterial({ color: new THREE.Color(this.skin.accent).multiplyScalar(1.4), transparent: true, opacity: 0, depthWrite: false });
    const ring = new THREE.Shape();
    ring.moveTo(-nw / 2 - bar, -nh / 2 - bar).lineTo(nw / 2 + bar, -nh / 2 - bar).lineTo(nw / 2 + bar, nh / 2 + bar).lineTo(-nw / 2 - bar, nh / 2 + bar).closePath();
    const hole = new THREE.Path();
    hole.moveTo(-nw / 2, -nh / 2).lineTo(-nw / 2, nh / 2).lineTo(nw / 2, nh / 2).lineTo(nw / 2, -nh / 2).closePath();
    ring.holes.push(hole);
    b.goldMesh = new THREE.Mesh(new THREE.ShapeGeometry(ring), b.goldFace);
    b.goldMesh.position.z = 0.004;
    b.goldMesh.visible = false;
    b.glowMesh = new THREE.Mesh(new THREE.PlaneGeometry(nw + 1.5, nh + 1.5), new THREE.MeshBasicMaterial({ map: this.glow, color: this.skin.accent, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    b.glowMesh.position.z = -0.02;
    b.glowMesh.visible = false;
    g.add(b.goldMesh, b.glowMesh);
    this.stuff.add(g);
    // On the floor: the pool's edge, faint even when its lamp is out so it still reads as a place
    // to stand (as in the 3D look), and a soft wash inside it while the lamp is on. The picture
    // has the lamp's own light on the floor; these make the place to vote plain at a glance.
    const x = walkX(b.cx);
    // To where the room counts and no further on a placed wall (shared/world.js, drawnLight); the wash's soft edge too.
    const radius = this.light.pool * PX;
    const washSize = radius * (this.light.fade > 0 ? 2.3 : 2);
    const light = this.voteLight ?? this.skin.light;
    b.ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.018, radius + 0.018, 72), new THREE.MeshBasicMaterial({ color: light, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false }));
    b.ring.rotation.x = -Math.PI / 2;
    b.ring.position.set(x, 0.006, SPACE.walkZ);
    b.wash = new THREE.Mesh(new THREE.PlaneGeometry(washSize, washSize), new THREE.MeshBasicMaterial({ map: this.glow, color: light, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    b.wash.rotation.x = -Math.PI / 2;
    b.wash.position.set(x, 0.004, SPACE.walkZ);
    b.ringLight = new THREE.Color(light);
    b.ringGold = new THREE.Color(this.skin.accent);
    this.stuff.add(b.ring, b.wash);
    // The lamp is the room's own; the room's life swings the group it gives back.
    b.lamp = { swing: this.lamp(b, i) };
    return b;
  }

  /** A box's lamp changed its level of light: its poster and gold edge here; the lamp itself is set every frame (tick). */
  light(b) {
    if (this.plain) return super.light(b);
    const glowing = Math.min(1, b.level * 8);
    b.art.color.setScalar(this.posterShade(glowing, b.gold, b.level));
    // The screen's edge: the room's colour while its lamp is on, brighter for the box that leads.
    // (A room whose picture has its own frames, such as the bar's gold ones, has no edge drawn.)
    b.goldFace.opacity = Math.max(b.gold, 0.45 * glowing);
    b.glowMesh.material.opacity = 0.5 * b.gold;
    b.goldMesh.visible = this.frameRing && b.goldFace.opacity > 0.003;
    b.glowMesh.visible = b.gold > 0.003;
    b.ring.material.color.copy(b.ringLight).lerp(b.ringGold, b.gold);
    b.ring.material.opacity = Math.max(0.05 + 0.11 * glowing + 0.34 * Math.min(b.level, 1.2), b.gold);
    b.wash.material.opacity = 0.16 * Math.min(b.level, 1.3);
    b.wash.visible = b.level > 0.002;
  }

  // ---------------------------------------------------------------- the pieces, in the picture

  /** How bright the nearest lit lamp is at a world x, and where that lamp is: {lit, x}. */
  lampOver(xw) {
    let best = { lit: 0, x: xw, d: Infinity };
    for (const b of this.boxes) {
      if (!(b.level > 0.002)) continue;
      const d = Math.abs(xw - b.cx);
      // An even wall's lamp reaches well past its pool; a placed wall's ends at the counted edge (shared/world.js, drawnLight).
      const reach = this.light.fade > 0 ? 150 : 0;
      const lit = reach > 0 ? Math.max(0, Math.min(1, (this.half + reach - d) / reach)) : d <= this.half ? 1 : 0;
      if (d < best.d) best = { lit: Math.min(1, 0.5 + 0.5 * b.level) * lit, x: b.cx, d };
    }
    return best;
  }

  /**
   * The 3D look dims the paint outside a pool and makes it glow inside one, because it has no
   * real light. Here there is light: each character gives its body its true colour and a shinier
   * finish (look3d/characters.js, `bake`), after it is posed and before an emote lays its red on.
   */
  finish(p) {
    if (!this.plain) p.kind.bake(p.body);
  }

  /**
   * Just before each picture is drawn, after the 3D look has posed every piece: a shadow that
   * leans away from the nearest lit lamp, and its reflection in the floor, as its character makes it.
   */
  dressPieces() {
    const seen = new Set();
    for (const p of this.pieces.values()) {
      const body = p.body;
      seen.add(body);
      const lamp = this.lampOver(p.rx);
      const away = lamp.lit > 0 ? Math.max(-1, Math.min(1, (p.rx - lamp.x) / (this.half + 60))) : 0;
      body.blob.position.x += away * 0.2;
      body.blob.scale.multiplyScalar(1.3);
      body.blob.scale.x *= 1 + Math.abs(away) * 0.6;
      body.blob.material.opacity = Math.min(1, body.blob.material.opacity * (0.75 + 0.8 * lamp.lit));
      if (!body.reflection) this.mirror.add((body.reflection = new Reflection(body)));
      body.reflection.update(0.4 + 0.6 * lamp.lit, 0.16 + 0.2 * lamp.lit);
    }
    for (const r of [...this.mirror.children]) {
      if ([...seen].some((body) => body.reflection === r)) continue;
      r.dispose();
      this.mirror.remove(r);
    }
  }

  // ---------------------------------------------------------------- every frame

  frame(now, dt, own, frame) {
    this.view = frame;
    super.frame(now, dt, own, frame);
  }

  /** A blow jolts the picture for a moment, unless nothing in this room shakes. */
  jolt(now) {
    return this.still && !this.plain ? { x: 0, y: 0 } : super.jolt(now);
  }

  /** Where the eye is for a view, in metres to the side of the 3D look's: it follows the view's middle by `eye`. */
  eyeAt(view) {
    if (!this.eye || !view) return 0;
    const middle = view.x + view.width / 2;
    return Math.max(-6, Math.min(6, (middle - 960) / U)) * this.eye;
  }

  /**
   * Puts the eye where the view says, and sees from there through the same window on the walking
   * line, so everything on that line (the pieces, their tags, the pools, the emotes) is where the
   * room's numbers say it is on the screen, and nearer and farther things move against it. The
   * words on the wall move with the wall.
   */
  placeEye() {
    const view = this.view;
    const ex = this.eyeAt(view);
    const cam = this.camera;
    if (!view || (!ex && !cam.position.x)) return;
    const k = 1 / D_WALL;
    const dk = CAM.z - SPACE.walkZ;
    cam.position.x = ex;
    cam.updateMatrixWorld();
    cam.projectionMatrix.makePerspective((wallX(view.x) * WALK - ex) / dk, (wallX(view.x + view.width) * WALK - ex) / dk, (wallY(view.y) - CAM.y) * k, (wallY(view.y + view.height) - CAM.y) * k, 1, 90);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    // The wall, seen from the moved eye, is where a wall seen from the middle would be had it slid this far (world units).
    const shift = (this.wallShiftWorld = ex * U * (1 / WALK - 1));
    const s = (this.el.clientWidth || 1) / view.width;
    const css = `translate(${((-view.x + shift) * s).toFixed(1)}px, ${(-view.y * s).toFixed(1)}px)`;
    // (Written again whenever the words have put their own there: the view moved.)
    if (css !== this.wallShift || this.words.movedKey !== this.wordsKey) {
      this.words.wall.style.transform = this.wallShift = css;
      this.wordsKey = this.words.movedKey;
    }
  }

  /** Draws one picture: what is outside first, cut to the glass, then the room over it. */
  draw() {
    // A picture here is two drawings (outside, then the room): the count of draw calls is for both.
    this.renderer.info.autoReset = this.plain;
    if (this.plain) return super.draw();
    this.renderer.info.reset();
    this.placeEye();
    this.dressPieces();
    // (A check that compares two drawings holds the clock, so nothing that breathes moves between them.)
    this.tick(this.clockHeld ?? performance.now());
    const [w, h] = [this.el.clientWidth, this.el.clientHeight];
    const cam = this.camera;
    if (!this.outside) return void this.renderer.render(this.scene, cam);
    farCamera(cam, this.outCam, 1600);
    drawOutsideFirst(this.renderer, this.outside, this.outCam, this.scene, cam, windowBox(cam, w, h, this.sill, this.across), this.halfOutside);
  }

  /** Slow frames: the ladder, or (a software renderer in a test) the 3D look's own governor. */
  govern(dt) {
    if (this.plain || !this.ladder) return super.govern(dt);
    const act = this.ladder.frame(performance.now(), dt * 1000);
    if (!act) return;
    if (act.ratio) this.ratio = act.ratio;
    else if (act.take) this.step(act.take, true);
    else if (act.undo) for (const s of act.undo) this.step(s, false);
    else if (act.fallback) return void this.fallBack();
    // Remembered, so the next visit starts where this one came to; a capped device, so it does not try again.
    if (!this.rung.forced) rememberRung(this.ladder.done === "capped" ? "capped" : [...this.ladder.taken]);
  }

  /**
   * For checks (lobby/test/shoot-real.mjs): does a passing thing change any pixel that is not glass,
   * anywhere along its way? This moment of the room is drawn with nothing passing, then only its
   * glass (in white), then with `name` at each of `steps` + 1 points of its way, and the pixels each
   * changed are counted, with how many of those are not glass. Nothing else moves between the
   * drawings. The room says what a thing at a point of its way is (passAt) and draws what is outside
   * this instant with it (putOutside).
   */
  leaks(name, steps = 12, opts = {}) {
    const gl = this.renderer.getContext();
    const [w, h] = [gl.drawingBufferWidth, gl.drawingBufferHeight];
    const grab = () => {
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };
    const put = (ev) => {
      this.putOutside(ev);
      this.draw();
    };
    this.clockHeld = performance.now();
    put(null);
    const empty = grab();
    // The pieces were dressed for this picture once (dressing is done to a fresh pose each frame); not again.
    this.dressPieces = () => {};
    this.shellMat.uniforms.uProbe.value = 1;
    this.renderer.setScissorTest(false);
    this.renderer.clear();
    this.renderer.render(this.shellMesh, this.camera);
    const glass = grab();
    this.shellMat.uniforms.uProbe.value = 0;
    let panes = 0;
    for (let i = 0; i < glass.length; i += 4) if (glass[i] > 0) panes++;
    const changed = [];
    const leaked = [];
    let worst = 0;
    for (let s = 0; s <= steps; s++) {
      put(this.passAt(name, s / steps, opts));
      const full = grab();
      let [c, l] = [0, 0];
      for (let i = 0; i < empty.length; i += 4) {
        const d = Math.max(Math.abs(empty[i] - full[i]), Math.abs(empty[i + 1] - full[i + 1]), Math.abs(empty[i + 2] - full[i + 2]));
        if (!d) continue;
        c++;
        if (glass[i] === 0) {
          l++;
          worst = Math.max(worst, d);
        }
      }
      changed.push(c);
      leaked.push(l);
    }
    delete this.dressPieces;
    this.clockHeld = null;
    this.idle = 0;
    return { changed, leaked, worst, glass: panes, pixels: w * h };
  }

  /** The steps this drawing has taken now. */
  get taken() {
    return this.ladder ? [...this.ladder.taken] : this.rung.taken;
  }

  /**
   * The bottom of the ladder: the room is drawn as the 3D look draws it from now on, here and on
   * this device's next visits (until ?look=real asks again), with one short note that says so.
   */
  fallBack(note = true) {
    this.fellBack = true;
    if (!this.rung.forced) rememberRung("3d");
    this.roomLights(false);
    this.scene.background = new THREE.Color(0x03050c);
    // The pieces are made afresh, so none of them keeps the rendered room's paint.
    for (const p of this.pieces.values()) this.removePiece(p);
    this.pieces.clear();
    for (const r of [...this.mirror.children]) {
      r.dispose();
      this.mirror.remove(r);
    }
    this.slow = { ms: 16, frames: 0, tried: null, locked: false };
    const room = this.room;
    if (room) {
      this.build(room);
      this.setRoom(room, performance.now());
    }
    this.idle = 0;
    // The page's own slow check starts again from here (slow-room.js).
    window.dispatchEvent(new CustomEvent("party-room:look-changed", { detail: { look: this.lookName } }));
    if (note) this.say(FELL_BACK_NOTE);
  }

  /** A short note over the room that the player can close; it goes by itself after a while. */
  say(words) {
    const app = document.getElementById("app") ?? this.el.parentElement;
    if (!app) return;
    this.note?.remove();
    const el = (this.note = document.createElement("div"));
    el.className = "slow-offer rendered-note";
    el.setAttribute("role", "status");
    const span = document.createElement("span");
    span.textContent = words;
    const shut = document.createElement("button");
    shut.type = "button";
    shut.className = "slow-no";
    shut.textContent = "×";
    shut.setAttribute("aria-label", "Close");
    shut.addEventListener("click", () => el.remove());
    el.append(span, shut);
    app.append(el);
    setTimeout(() => el.remove(), 12_000);
  }

  /** What the frame meter calls this look: "real", or "3d" once it has fallen back (or the wall is not the picture's). */
  get lookName() {
    return this.plain ? "3d" : "real";
  }

  /** For the frame meter: the room, with how far down its ladder it is ("star-lounge lite 2"), so the line reads "real star-lounge lite 2". */
  get drawing() {
    return { ...super.drawing, skin: this.plain ? this.def.name : rungName(this.def, this.taken) };
  }

  stats() {
    return { ...super.stats(), look: this.lookName, rung: `${this.lookName} ${this.drawing.skin}`, taken: this.taken, plate: this.base?.image?.width ?? 0 };
  }

  destroy() {
    this.note?.remove();
    for (const r of this.mirror.children) r.dispose();
    this.envMap?.dispose();
    this.glow?.dispose();
    for (const t of [this.base, this.lights, this.sheet, this.env]) t?.dispose();
    super.destroy();
    if (window.__roomRendered === this) window.__roomRendered = null;
  }
}
