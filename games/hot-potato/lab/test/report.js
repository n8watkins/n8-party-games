// Reads the page's own copied report (v1 to v4) back into turns, so a real run can be
// replayed through the matcher. Used by logic.test.js and tools/replay-report.mjs.
import { CATEGORIES } from "../../shared/categories.js";

/**
 * Each turn: {n, category (v3 names it after the rules version; earlier reports are all
 * cities), wide (lesser-known entries allowed: "wide" from v4, "hard" before), suggestion (v4:
 * "read" when the answer was one of the suggestions shown, "own", "hidden"; "" before), need, verdict ("RIGHT", "WRONG", "NONE"), verdictText, decidedBy, interim (the
 * interim phrase that was answered, when the verdict was taken from one), alternatives
 * [{transcript, confidence}] of the final result}.
 */
export function parseReport(text) {
  const turns = [];
  for (const line of text.split("\n")) {
    if (!/^#\d+ /.test(line)) continue;
    const parts = line.split(" | ");
    const head = parts[0];
    const verdictText = parts[2] ?? "";
    const heard = parts[3] ?? "-";
    const n = Number(head.match(/^#(\d+)/)[1]);
    const words = head.split(" ");
    const category = words.find((w) => Object.hasOwn(CATEGORIES, w)) ?? "cities";
    // The list: "known", or "wide" (lesser-known ones allowed; reports before v4 wrote "hard").
    const wide = words.includes("wide") || words.includes("hard");
    // Whether the answer was one of the suggestions shown (v4 on): "read", "own", "hidden" or "".
    const suggestion = parts[4]?.match(/(?:^| )sugg:(\S+)/)?.[1] ?? "";
    const need = head.match(/need:(\S+)/)?.[1] ?? "-";
    const decidedBy = verdictText.match(/by (interim|final)\)/)?.[1] ?? "";
    const interim = decidedBy === "interim" ? (verdictText.match(/heard "([^"]*)"/)?.[1] ?? "") : "";
    const alternatives =
      heard === "-" || heard.startsWith("interim:")
        ? []
        : heard.split(" / ").map((s) => {
            const at = s.lastIndexOf("=");
            return { transcript: s.slice(0, at), confidence: Number(s.slice(at + 1)) };
          });
    turns.push({ n, category, wide, suggestion, need: need === "-" ? "" : need, verdict: verdictText.split(" ")[0], verdictText, decidedBy, interim, alternatives });
  }
  return turns;
}
