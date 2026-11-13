// The rooms page: every skin in look3d/skins.js with its picture, whether it is live or a
// concept, one line on what makes the room itself, what happens in it, and the sounds it would
// want. Live rooms also get a short loop of an event and a reaction. The pictures are taken by
// lobby/test/shoot-3d-stills.mjs and made by lobby/test/make-room-pictures.py.
import { SKINS } from "../skins.js";

const list = document.getElementById("rooms");
const el = (tag, className, text, parent) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  parent?.append(node);
  return node;
};
const picture = (parent, src, alt, width, height) => {
  const img = el("img", "", "", parent);
  img.src = src;
  img.alt = alt;
  img.loading = "lazy";
  img.width = width;
  img.height = height;
  return img;
};

const skins = Object.values(SKINS).sort((a, b) => Number(b.live) - Number(a.live));
for (const skin of skins) {
  const card = el("article", "room", "", list);
  const head = el("h2", "", "", card);
  el("span", "", skin.name, head);
  el("span", skin.live ? "badge live" : "badge concept", skin.live ? "Live" : "Concept", head);
  el("p", "line", skin.line, card);

  const pictures = el("div", skin.live ? "pictures two" : "pictures", "", card);
  const still = el("a", "picture", "", pictures);
  still.href = `../still.html?room=${skin.id}`;
  picture(still, `${skin.id}.jpg`, `${skin.name}: four pieces in the middle of a vote`, 1280, 660);
  if (skin.live) {
    const loop = el("a", "picture", "", pictures);
    loop.href = `../still.html?room=${skin.id}&show=1&run=1`;
    picture(loop, `${skin.id}.webp`, `${skin.name}, moving: something passes, someone is bumped by the room's own thing, someone jumps under a lamp`, 640, 360);
    el("span", "caption", "Five seconds of it, on a loop", loop);
  }

  const words = el("div", "words", "", card);
  if (skin.happens?.length) {
    el("h3", "", "What happens", words);
    const happens = el("ul", "", "", words);
    for (const line of skin.happens) el("li", "", line, happens);
  }
  const sounds = Object.entries(skin.sounds ?? {});
  if (sounds.length) {
    const fold = el("details", "", "", words);
    el("summary", "", "Sounds this room would want (none is played yet)", fold);
    const table = el("ul", "sounds", "", fold);
    for (const [name, what] of sounds) {
      const row = el("li", "", "", table);
      el("code", "", name, row);
      el("span", "", what, row);
    }
  }
  const links = el("p", "links", "", words);
  if (skin.live) {
    const play = el("a", "button", "Start a party in this room", links);
    play.href = `/lobby/?start&look=3d&room=${skin.id}`;
  }
  const posed = el("a", "plain", "Open the posed room", links);
  posed.href = `../still.html?room=${skin.id}`;
  const showing = el("a", "plain", "Watch the little show", links);
  showing.href = `../still.html?room=${skin.id}&show=1&run=1`;
}
