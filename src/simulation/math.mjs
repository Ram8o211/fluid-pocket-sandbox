export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const saturate = (v) => clamp(v, 0, 1);
export function length3(x, y, z) { return Math.hypot(x, y, z); }
export function normalize3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
export function finite(v, fallback = 0) { return Number.isFinite(v) ? v : fallback; }
export function hexToRgb(hex) {
  const raw = hex.replace('#', '').padEnd(6, '0').slice(0, 6);
  const n = Number.parseInt(raw, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export function rgbToHex(r, g, b) {
  const f = (x) => Math.round(saturate(x) * 255).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}
