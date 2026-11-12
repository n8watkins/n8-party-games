// The picture on each game's box: simple drawn shapes, one function per game. Each draws into a
// group whose corner is the poster's top left, `w` wide and `h` tall. Titles are fitted to the
// width after the poster is in the page (the scene calls fit on anything marked data-fit).
import { label, s } from "./dom.js";

const title = (text, x, y, size, fill, max, cls = "t-poster") => label(text, { x, y, "font-size": size, fill, "text-anchor": "middle", class: cls, "data-fit": max });

function star(cx, cy, r, fill) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const k = i % 2 ? r * 0.45 : r;
    pts.push(`${(cx + Math.cos(a) * k).toFixed(1)},${(cy + Math.sin(a) * k).toFixed(1)}`);
  }
  return s("polygon", { points: pts.join(" "), fill });
}

function target(cx, cy, r, text) {
  return s("g", {}, s("circle", { cx, cy, r, fill: "#e9c25a", stroke: "#7a5a1a", "stroke-width": 2 }), label(text, { x: cx, y: cy + r * 0.36, "font-size": r * 0.95, fill: "#5a3d0c", "text-anchor": "middle", class: "t-display" }));
}

const ART = {
  "cork-and-bell"(g, w, h) {
    g.append(s("rect", { width: w, height: h, fill: "#9c2b20" }), s("rect", { width: w, height: 64, fill: "#6f1a14" }));
    g.append(title("Cork & Bell", w / 2, 43, 30, "#f6d9a0", w - 22, "t-display"));
    // The awning's scalloped edge.
    for (let i = 0, n = Math.ceil(w / 26); i <= n; i++) g.append(s("circle", { cx: i * 26, cy: 66, r: 13, fill: i % 2 ? "#f1e2c2" : "#c8382c" }));
    g.append(s("rect", { x: 14, y: 92, width: w - 28, height: 66, rx: 4, fill: "#183a2e" }), s("rect", { x: 14, y: 150, width: w - 28, height: 8, fill: "#c8963e" }));
    for (const k of [0.22, 0.5, 0.78]) g.append(star(w * k, 124, 21, "#f0c64e"));
    g.append(s("rect", { x: 14, y: 168, width: w - 28, height: 62, rx: 4, fill: "#22365a" }), s("rect", { x: 14, y: 222, width: w - 28, height: 8, fill: "#c8963e" }));
    for (const k of [0.22, 0.5, 0.78]) g.append(target(w * k, 196, 19, "25"));
    g.append(s("rect", { x: 0, y: 240, width: w, height: 60, fill: "#b3352a" }));
    g.append(target(34, 270, 17, "10"), target(w - 34, 270, 17, "10"));
    // The bell.
    g.append(s("path", { d: `M${w / 2 - 20},284 Q${w / 2 - 20},252 ${w / 2},252 Q${w / 2 + 20},252 ${w / 2 + 20},284 Z`, fill: "#f0c64e", stroke: "#7a5a1a", "stroke-width": 2 }), s("circle", { cx: w / 2, cy: 288, r: 5, fill: "#7a5a1a" }));
  },

  "coin-flip"(g, w, h) {
    g.append(s("rect", { width: w, height: h, fill: "#1b4753" }), s("rect", { y: h - 86, width: w, height: 86, fill: "#143842" }));
    g.append(s("circle", { cx: w / 2, cy: 128, r: 66, fill: "#f3c240", stroke: "#a8780f", "stroke-width": 6 }), s("circle", { cx: w / 2, cy: 128, r: 51, fill: "none", stroke: "#c9972a", "stroke-width": 3 }));
    g.append(star(w / 2, 128, 34, "#a8780f"));
    g.append(title("COIN FLIP", w / 2, 252, 30, "#fdf3d6", w - 24));
    g.append(title("luck picks the order", w / 2, 278, 14, "#a9cdd6", w - 24, "t-ui"));
  },

  "who-am-i"(g, w, h) {
    g.append(s("rect", { width: w, height: h, fill: "#efe4d6" }));
    g.append(s("rect", { x: w / 2 - 52, y: 52, width: 104, height: 104, rx: 24, fill: "#5b3fd6" }), s("circle", { cx: w / 2, cy: 104, r: 33, fill: "#ffffff" }));
    g.append(label("?", { x: w / 2, y: 121, "font-size": 50, fill: "#5b3fd6", "text-anchor": "middle", class: "t-poster" }));
    g.append(title("Who Am I?", w / 2, 222, 30, "#2a1b3d", w - 24));
    g.append(s("rect", { x: w / 2 - 26, y: 240, width: 52, height: 4, rx: 2, fill: "#5b3fd6" }));
  },

  "tin-derby"(g, w, h) {
    g.append(s("rect", { width: w, height: h, fill: "#ef6539" }));
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const b = a + Math.PI / 9;
      g.append(s("polygon", { points: `${w / 2},178 ${w / 2 + Math.cos(a) * 400},${178 + Math.sin(a) * 400} ${w / 2 + Math.cos(b) * 400},${178 + Math.sin(b) * 400}`, fill: "#f48257" }));
    }
    g.append(title("TIN", w / 2, 56, 42, "#fff1d6", w - 30), title("DERBY", w / 2, 100, 42, "#fff1d6", w - 30));
    const cx = w / 2;
    g.append(s("rect", { x: cx - 30, y: 138, width: 60, height: 34, rx: 12, fill: "#f7dc8c" }), s("rect", { x: cx - 20, y: 144, width: 34, height: 18, rx: 5, fill: "#27356b" }));
    g.append(s("rect", { x: cx - 66, y: 162, width: 132, height: 36, rx: 14, fill: "#f7dc8c" }), s("rect", { x: cx - 66, y: 176, width: 132, height: 7, fill: "#d8402a" }));
    for (const k of [-38, 38]) g.append(s("circle", { cx: cx + k, cy: 202, r: 17, fill: "#1b1614" }), s("circle", { cx: cx + k, cy: 202, r: 6, fill: "#f6ead2" }));
    const size = w / 8;
    for (let row = 0; row < 2; row++) for (let i = 0; i < 8; i++) g.append(s("rect", { x: i * size, y: h - (2 - row) * size, width: size + 0.5, height: size + 0.5, fill: (i + row) % 2 ? "#1b1614" : "#f6ead2" }));
  },

  flood(g, w, h) {
    g.append(s("rect", { width: w, height: h, fill: "#1b2f8a" }));
    g.append(s("circle", { cx: w - 48, cy: 46, r: 17, fill: "#f6e7b8" }), s("circle", { cx: w - 56, cy: 41, r: 15, fill: "#1b2f8a" }));
    g.append(title("FLOOD", w / 2, 112, 48, "#ffffff", w - 28));
    const cx = w / 2;
    g.append(s("rect", { x: cx - 30, y: 168, width: 60, height: 52, fill: "#f3e3bd" }), s("polygon", { points: `${cx - 44},170 ${cx},132 ${cx + 44},170`, fill: "#d8402a" }), s("rect", { x: cx - 8, y: 184, width: 16, height: 16, fill: "#e3b94a" }));
    const wave = (y, fill) => {
      let d = `M0,${y}`;
      for (let x = 0; x < w; x += 40) d += ` q10,-12 20,0 t20,0`;
      return s("path", { d: `${d} V${h} H0 Z`, fill });
    };
    g.append(wave(208, "#5d8fe6"), wave(234, "#3f6fd0"), wave(262, "#2f55b5"));
  },
};

/** Draws the box art for `id` into `g`; a game with no picture of its own gets its name on a plain panel. */
export function drawArt(id, g, w, h, name) {
  if (ART[id]) return ART[id](g, w, h);
  g.append(s("rect", { width: w, height: h, fill: "#3a2a4a" }), title(name, w / 2, h / 2, 30, "#f6ead2", w - 24));
}
