// Deterministic maths for the race rules.
//
// JavaScript's +, -, *, / and Math.sqrt are exact IEEE-754 on every engine, but Math.sin, Math.cos,
// Math.atan2, Math.hypot and Math.pow are not: the standard lets each engine round them its own way,
// and V8 (Chrome, Node, the Workers runtime) and JavaScriptCore (every browser on an iPhone) do differ in
// the last bit. A race is a chaotic system (one bump decides the next), so a last bit is enough for two
// devices to tell two different races from the same inputs.
//
// Everything here is built from the exact operations only, so the same inputs give the same bits in the
// room, in Node, in Chrome and in Safari. The rules use nothing else for angles and distances.
// The polynomials are the classic fdlibm ones; they agree with Math.* to about 1e-15 (test/dmath.test.js).

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
const HALF_PI = 1.5707963267948966;
const TWO_OVER_PI = 0.6366197723675814;
// Half pi in two parts: the first has only 33 significant bits, so k * PIO2_1 is exact for any k a race can reach.
const PIO2_1 = 1.5707963267341256;
const PIO2_1T = 6.077100506506192e-11;

const S1 = -1.66666666666666324348e-1, S2 = 8.33333333332248946124e-3, S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6, S5 = -2.50507602534068634195e-8, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2, C2 = -1.38888888888741095749e-3, C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7, C5 = 2.0875723212981748279e-9, C6 = -1.13596475577881948265e-11;

/** sin on [-pi/4, pi/4]. */
function ksin(r) {
  const z = r * r;
  return r + r * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
}
/** cos on [-pi/4, pi/4]. */
function kcos(r) {
  const z = r * r;
  return 1 - 0.5 * z + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
}

/** Which quarter turn x is nearest (k), and what is left over (returned): x = k * pi/2 + r. */
let quarter = 0;
function reduce(x) {
  const k = Math.round(x * TWO_OVER_PI);
  quarter = k & 3;
  return x - k * PIO2_1 - k * PIO2_1T;
}

export function sin(x) {
  const r = reduce(x);
  return quarter === 0 ? ksin(r) : quarter === 1 ? kcos(r) : quarter === 2 ? -ksin(r) : -kcos(r);
}

export function cos(x) {
  const r = reduce(x);
  return quarter === 0 ? kcos(r) : quarter === 1 ? -ksin(r) : quarter === 2 ? -kcos(r) : ksin(r);
}

export function tan(x) {
  return sin(x) / cos(x);
}

const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.1111110405462355788e-1,
  9.09088713343650656196e-2, -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2,
  4.97687799461593236017e-2, -3.65315727442169155270e-2, 1.62858201153657823623e-2,
];
const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.570796326794896558];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];

/** atan of x >= 0. */
function atanPos(x) {
  let id = -1;
  if (x >= 0.4375) {
    if (x < 0.6875) { id = 0; x = (2 * x - 1) / (2 + x); }
    else if (x < 1.1875) { id = 1; x = (x - 1) / (x + 1); }
    else if (x < 2.4375) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); }
    else { id = 3; x = -1 / x; }
  }
  const z = x * x, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  return id < 0 ? x - x * (s1 + s2) : ATAN_HI[id] - (x * (s1 + s2) - ATAN_LO[id] - x);
}

export function atan(x) {
  return x < 0 ? -atanPos(-x) : atanPos(x);
}

/** The angle of the point (x, y), -pi to pi. A zero's sign is ignored (a saved race does not keep it): atan2(0, -1) is pi. */
export function atan2(y, x) {
  if (x === 0) return y > 0 ? HALF_PI : y < 0 ? -HALF_PI : 0;
  if (y === 0) return x > 0 ? 0 : PI;
  const a = atanPos(Math.abs(y / x));
  return x > 0 ? (y > 0 ? a : -a) : y > 0 ? PI - a : a - PI;
}

/** The length of (x, y). (Math.hypot is not exact everywhere; a square root of a sum is.) */
export function hypot(x, y) {
  return Math.sqrt(x * x + y * y);
}

/** An angle brought into -pi to pi. */
export function wrapA(a) {
  return atan2(sin(a), cos(a));
}
