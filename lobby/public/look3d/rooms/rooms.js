// The rooms page: every skin in look3d/skins.js with its still, whether it is live or a
// concept, and one line on what makes the room itself. The stills are taken by
// lobby/test/shoot-3d-stills.mjs --publish=1.
import { SKINS } from "../skins.js";

const list = document.getElementById("rooms");
const el = (tag, className, text, parent) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  parent?.append(node);
  return node;
};

const skins = Object.values(SKINS).sort((a, b) => Number(b.live) - Number(a.live));
for (const skin of skins) {
  const card = el("article", "room", "", list);
  const picture = el("a", "picture", "", card);
  picture.href = `../still.html?room=${skin.id}`;
  const img = el("img", "", "", picture);
  img.src = `${skin.id}.jpg`;
  img.alt = `${skin.name}: four pieces in the middle of a vote`;
  img.loading = "lazy";
  img.width = 1920;
  img.height = 990;
  const words = el("div", "words", "", card);
  const head = el("h2", "", "", words);
  el("span", "", skin.name, head);
  el("span", skin.live ? "badge live" : "badge concept", skin.live ? "Live" : "Concept", head);
  el("p", "", skin.line, words);
  const links = el("p", "links", "", words);
  if (skin.live) {
    const play = el("a", "button", "Start a party in this room", links);
    play.href = `/lobby/?start&look=3d&room=${skin.id}`;
  }
  const posed = el("a", "plain", "Open the posed room", links);
  posed.href = `../still.html?room=${skin.id}`;
}
