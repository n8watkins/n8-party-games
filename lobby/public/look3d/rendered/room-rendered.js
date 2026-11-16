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
// On a device that cannot keep up it comes down its ladder (rendered/ladder.js) and at the
// bottom draws itself as the 3D look draws the room, in place, without the page swapping views.
// A wall with a different number of boxes than its picture is drawn by the 3D look as it stands.
import { boxCentre } from "../../shared/world.js";
import { boxArt } from "../paint.js";
import { Room3D } from "../room3d.js";
import { FRAME, PX, SPACE, walkX } from "../space.js";
import * as THREE from "../three.js";
import { Ladder } from "./ladder.js";
import { drawOutsideFirst, farCamera, radialTexture, shellGroup, shellMaterial, windowBox } from "./plate.js";
import { rememberRung, rungName, rungOf } from "./switch.js";

export class RoomRendered extends Room3D {
  /** Starts the drawing in `root`. Throws when the device cannot draw it or its layers do not arrive, so the page can open the 3D look instead. */
  static async open(root, opts) {
    const view = await super.open(root, { ...opts, skin: this.SKIN });
    try {
      Object.assign(view, await view.loadLayers(opts));
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
    const rung = rungOf(def, params);
    this.rung = rung;
    // The ladder is for real devices: a test that asked for software drawing (?gl=any) is slow on
    // purpose, and stays on the rung it asked for (?rung=) unless it asks for the ladder
    // (?ladder=on); a measurement holds its rung with ?ladder=off.
    const ladder = params.get("ladder") ?? (params.get("gl") === "any" ? "off" : "on");
    this.ladder = ladder === "on" ? new Ladder({ ratio: this.ratio, steps: def.steps, taken: rung.taken }) : null;
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
    // The room's life: as the 3D look has it when it draws the room, the rendered room's own otherwise.
    this.skin = this.plain ? this.todaySkin : { ...this.todaySkin, life: this.ownLife(this.todaySkin.life ?? []) };
    this.el.classList.toggle("rendered", !this.plain);
    this.scene.background = this.plain ? new THREE.Color(0x03050c) : null;
    this.renderer.autoClear = this.plain;
    this.lamps = [];
    super.build(room);
    if (!this.plain) this.dress(room);
  }

  /** Which of the skin's life a rendered room keeps (the rest is in its picture or its own). */
  ownLife(life) {
    return life;
  }

  shell(L) {
    if (this.plain) return super.shell(L);
    this.shellMat = shellMaterial(this.plate, this.base, this.lights, this.lightNames, { exposure: this.exposure ?? 0.95 });
    this.shellMesh = shellGroup(this.shellMat);
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

  /** One game box: its poster in the picture's frame, a gold edge and glow for the box that leads, and its lamp. */
  box(box, i, L) {
    if (this.plain) return super.box(box, i, L);
    const b = { box, i, cx: boxCentre(i, L.n), level: 0, aim: 0, gold: 0, goldAim: 0, shown: -1 };
    b.pool = new THREE.Vector4(walkX(b.cx), SPACE.walkZ, (this.half + 12) * PX, 0);
    const g = new THREE.Group();
    g.position.set(L.xs[i], L.by, SPACE.zBack + 0.36);
    const tex = new THREE.CanvasTexture(boxArt(box, this.images));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    b.art = new THREE.MeshBasicMaterial({ map: tex });
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(L.bw, L.bh), b.art));
    const [nw, nh] = [L.bw + FRAME.gap * 2, L.bh + FRAME.gap * 2];
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
    const radius = (this.half + 12) * PX;
    b.ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.018, radius + 0.018, 72), new THREE.MeshBasicMaterial({ color: this.skin.light, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false }));
    b.ring.rotation.x = -Math.PI / 2;
    b.ring.position.set(x, 0.006, SPACE.walkZ);
    b.wash = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2.3, radius * 2.3), new THREE.MeshBasicMaterial({ map: this.glow, color: this.skin.light, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    b.wash.rotation.x = -Math.PI / 2;
    b.wash.position.set(x, 0.004, SPACE.walkZ);
    b.ringLight = new THREE.Color(this.skin.light);
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
    b.art.color.setScalar(0.34 + 0.56 * glowing + 0.22 * b.gold);
    // The screen's edge: the room's colour while its lamp is on, brighter for the box that leads.
    b.goldFace.opacity = Math.max(b.gold, 0.45 * glowing);
    b.glowMesh.material.opacity = 0.5 * b.gold;
    b.goldMesh.visible = b.goldFace.opacity > 0.003;
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
      if (d < best.d) best = { lit: Math.min(1, 0.5 + 0.5 * b.level) * Math.max(0, Math.min(1, (this.half + 150 - d) / 150)), x: b.cx, d };
    }
    return best;
  }

  /**
   * Just before each picture is drawn, after the 3D look has posed every piece: its true colour
   * (the light does the dimming here, not the paint), a shadow that leans away from the nearest
   * lit lamp, and its reflection in the floor.
   */
  dressPieces() {
    const seen = new Set();
    for (const p of this.pieces.values()) {
      const pawn = p.pawn;
      seen.add(pawn);
      if (!pawn.rendered) {
        pawn.rendered = true;
        pawn.mat.roughness = 0.3;
        pawn.mat.clearcoat = 1;
        pawn.mat.clearcoatRoughness = 0.12;
        pawn.mat.envMapIntensity = 1;
      }
      // The 3D look dims the paint outside a pool and makes it glow inside one, because it has no real light. Here there is light.
      const flicker = Math.max(0, pawn.mat.emissiveIntensity - (0.09 + 0.27 * pawn.lit) - 0.01);
      pawn.mat.color.copy(pawn.colour);
      pawn.mat.emissiveIntensity = 0.03 + flicker * 0.6;
      const lamp = this.lampOver(p.rx);
      const away = lamp.lit > 0 ? Math.max(-1, Math.min(1, (p.rx - lamp.x) / (this.half + 60))) : 0;
      pawn.blob.position.x += away * 0.2;
      pawn.blob.scale.multiplyScalar(1.3);
      pawn.blob.scale.x *= 1 + Math.abs(away) * 0.6;
      pawn.blob.material.opacity = Math.min(1, pawn.blob.material.opacity * (0.75 + 0.8 * lamp.lit));
      let r = pawn.reflection;
      if (!r) {
        // Only the body is mirrored: a floor this soft does not hold a pair of eyes.
        r = pawn.reflection = pawn.group.clone();
        r.traverse((o) => {
          if (!o.isMesh) return;
          o.visible = o.material === pawn.mat;
          if (!o.visible) return;
          o.material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
          o.renderOrder = -2;
        });
        this.mirror.add(r);
      }
      const [tilt, mt] = [pawn.group.children[0], r.children[0]];
      const [turn, mturn] = [tilt.children[0], mt.children[0]];
      r.position.set(pawn.group.position.x, -pawn.group.position.y, pawn.group.position.z);
      r.scale.set(1, -1, 1);
      mt.rotation.copy(tilt.rotation);
      mt.scale.copy(tilt.scale);
      mturn.rotation.copy(turn.rotation);
      const body = mturn.children[0];
      body.material.color.copy(pawn.mat.color).multiplyScalar(0.4 + 0.6 * lamp.lit);
      body.material.opacity = (0.16 + 0.2 * lamp.lit) * (pawn.fade ?? 1) * Math.max(0, 1 - pawn.group.position.y * 0.9);
    }
    for (const r of [...this.mirror.children]) {
      if ([...seen].some((pawn) => pawn.reflection === r)) continue;
      r.traverse((o) => o.isMesh && o.visible && o.material.dispose());
      this.mirror.remove(r);
    }
  }

  // ---------------------------------------------------------------- every frame

  /** Draws one picture: what is outside first, cut to the glass, then the room over it. */
  draw() {
    // A picture here is two drawings (outside, then the room): the count of draw calls is for both.
    this.renderer.info.autoReset = this.plain;
    if (this.plain) return super.draw();
    this.renderer.info.reset();
    this.dressPieces();
    this.tick(performance.now());
    const [w, h] = [this.el.clientWidth, this.el.clientHeight];
    const cam = this.camera;
    if (!this.outside) return void this.renderer.render(this.scene, cam);
    farCamera(cam, this.outCam, 1600);
    drawOutsideFirst(this.renderer, this.outside, this.outCam, this.scene, cam, windowBox(cam, w, h, this.sill), this.halfOutside);
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
    if (!this.rung.forced) rememberRung([...this.ladder.taken]);
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
    for (const r of [...this.mirror.children]) this.mirror.remove(r);
    this.slow = { ms: 16, frames: 0, tried: null, locked: false };
    const room = this.room;
    if (room) {
      this.build(room);
      this.setRoom(room, performance.now());
    }
    this.idle = 0;
    // The page's own slow check starts again from here (slow-room.js).
    window.dispatchEvent(new CustomEvent("party-room:look-changed", { detail: { look: this.lookName } }));
    if (note) this.say("This device draws the simpler room.");
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
    this.mirror.traverse((o) => o.isMesh && o.visible && o.material.dispose());
    this.envMap?.dispose();
    this.glow?.dispose();
    for (const t of [this.base, this.lights, this.sheet, this.env]) t?.dispose();
    super.destroy();
    if (window.__roomRendered === this) window.__roomRendered = null;
  }
}
