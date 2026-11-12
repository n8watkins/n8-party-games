// Writes game/shared/layout.js out as JSON for the Blender script (tools/blender/layout.json).
import { writeFileSync } from "node:fs";
import * as layout from "../../game/shared/layout.js";

const out = {};
for (const [key, value] of Object.entries(layout)) if (typeof value !== "function") out[key] = value;
writeFileSync(new URL("./layout.json", import.meta.url), JSON.stringify(out, null, 1));
console.log("layout.json written");
