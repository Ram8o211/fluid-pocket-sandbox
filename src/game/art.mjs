import { mulberry32 } from '../materials/MaterialGenerator.mjs';

// All artwork is original: small, reusable pixel sprites and a seeded workshop.
// No external fonts, stock images, emoji, downloads or runtime art dependencies.
const cache = new Map();
function surface(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function bottleSprite(colour = '#74d7c9', style = 0) {
  const key = `bottle:${colour}:${style}`; if (cache.has(key)) return cache.get(key);
  const canvas = surface(24, 32), ctx = canvas.getContext('2d');
  const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  rect(9, 1, 6, 4, '#38283b'); rect(10, 1, 4, 3, '#b78a54');
  rect(8, 5, 8, 7, '#362e47'); rect(5, 11, 14, 3, '#362e47');
  rect(3, 14, 18, 13, '#362e47'); rect(5, 27, 14, 3, '#362e47');
  rect(9, 6, 6, 7, '#9eadbb'); rect(6, 13, 12, 3, '#8d9caa');
  rect(4, 16, 16, 10, '#6e8195'); rect(6, 26, 12, 3, '#6e8195');
  rect(5, 17 + style % 3, 14, 8 - style % 3, colour); rect(7, 25, 10, 2, colour);
  rect(6, 15, 2, 7, '#d4eee7'); rect(6, 15, 6, 2, '#d4eee7');
  rect(15, 24, 3, 2, '#4d5b71'); rect(9, 20, 7, 4, '#d9c49a');
  rect(11, 21, 3, 2, '#6f5144');
  const url = canvas.toDataURL(); cache.set(key, url); return url;
}

export function portraitSprite(seed, mood = 'neutral') {
  const key = `portrait:${seed}:${mood}`; if (cache.has(key)) return cache.get(key);
  const rng = mulberry32(seed), canvas = surface(48, 48), ctx = canvas.getContext('2d');
  const skins = ['#e8bb91', '#b88367', '#8b5c4e', '#f2cba6'], hairs = ['#4d3643', '#ad6d3b', '#d0b179', '#5d6372', '#413c34'];
  const skin = skins[Math.floor(rng() * skins.length)], hair = hairs[Math.floor(rng() * hairs.length)];
  const cloth = ['#54775d', '#695681', '#a15c48', '#526d83'][Math.floor(rng() * 4)];
  const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  rect(0, 0, 48, 48, '#2b283c'); rect(3, 3, 42, 42, '#39334a');
  for (let i = 0; i < 16; i++) rect(Math.floor(rng() * 22) * 2, Math.floor(rng() * 22) * 2, 2, 2, '#554056');
  rect(12, 8, 24, 24, '#251f32'); rect(10, 14, 28, 14, '#251f32');
  rect(14, 12, 20, 20, skin); rect(12, 18, 24, 8, skin); rect(18, 30, 12, 6, skin);
  rect(12, 8, 24, 8, hair); rect(10, 12, 6, 16, hair); rect(32, 12, 6, 16, hair);
  rect(14, 10, 8, 8, hair); rect(26, 10, 8, 6, hair);
  rect(16, 20, 4, 4, '#252132'); rect(28, 20, 4, 4, '#252132');
  rect(16, 20, 2, 2, '#f8edce'); rect(28, 20, 2, 2, '#f8edce');
  rect(22, 23, 4, 3, '#af735d'); rect(20, 28, 8, 2, '#805042');
  if (mood === 'happy') { rect(18, 26, 2, 2, '#805042'); rect(28, 26, 2, 2, '#805042'); rect(14, 26, 3, 2, '#d79479'); rect(31, 26, 3, 2, '#d79479'); }
  if (mood === 'sad') { rect(20, 28, 8, 2, skin); rect(20, 27, 8, 2, '#805042'); rect(18, 29, 2, 2, '#805042'); rect(28, 29, 2, 2, '#805042'); }
  rect(8, 36, 32, 12, '#251f32'); rect(12, 34, 24, 14, cloth); rect(8, 40, 32, 8, cloth);
  rect(20, 34, 8, 4, '#dfc597'); rect(22, 38, 4, 10, '#b59762');
  if (rng() > .5) { rect(8, 6, 32, 4, cloth); rect(14, 2, 20, 4, cloth); rect(14, 6, 20, 2, '#d6ad68'); }
  if (rng() > .65) { rect(14, 20, 8, 2, '#d6ad68'); rect(26, 20, 8, 2, '#d6ad68'); rect(22, 20, 4, 2, '#d6ad68'); }
  const url = canvas.toDataURL(); cache.set(key, url); return url;
}

const PATHS = {
  coin: '<path fill="#8d5f32" d="M5 1h6v2h3v3h1v5h-2v3H4v-2H1V5h2V3h2z"/><path fill="#e4ba62" d="M5 3h5v1h2v7h-2v1H5v-2H3V5h2z"/><path fill="#fff0b1" d="M6 5h3v1H7v2h2v1H6z"/>',
  book: '<path fill="#513641" d="M2 2h12v13H2z"/><path fill="#9a6d53" d="M3 2h10v11H3z"/><path fill="#e0c08a" d="M4 3h2v9H4zm4 2h3v1H8zm0 3h3v1H8zm-5 6h10v1H3z"/>',
  guild: '<path fill="#e0c08a" d="M3 1h3v6h4V3h2V1h2v5l-3 4v5H8v-4L3 6z"/><path fill="#b06b41" d="M2 10h3v5H2zm1-3h1v3H3z"/>',
  settings: '<path fill="#af987c" d="M6 1h4v2h3v3h2v4h-2v3h-3v2H6v-2H3v-3H1V6h2V3h3z"/><path fill="#382b39" d="M6 6h4v4H6z"/>',
  flame: '<path fill="#af4938" d="M7 0h2v5h3v3h2v5h-2v2H4v-2H2V9h2V5h2z"/><path fill="#ea9d52" d="M7 5h2v4h2v4H5V9h2z"/><path fill="#f6d383" d="M7 10h2v4H7z"/>',
  frost: '<path fill="#93d8df" d="M7 0h2v5l3-3 1 2-3 3h6v2h-6l3 3-1 2-3-3v5H7v-5l-3 3-1-2 3-3H0V7h6L3 4l1-2 3 3z"/>',
  spoon: '<path fill="#cd9e67" d="M11 0h3v4h-2v3h-2v3H8v3H6v2H2v-4h2V9h2V7h2V5h2V3h1z"/><path fill="#f1cb8c" d="M3 11h2v2H3z"/>',
  measure: '<path fill="#d9c597" d="M2 2h12v12H2z"/><path fill="#5b6869" d="M4 4h8v8H4z"/><path fill="#e9aa68" d="M7 5h2v3h3v2H7z"/>',
  inventory: '<path fill="#5e3f37" d="M1 5h14v10H1z"/><path fill="#b88655" d="M2 6h12v7H2z"/><path fill="#e3c185" d="M5 2h6v3H5zm2 6h2v3H7z"/>',
  star: '<path fill="#dcbd76" d="M7 0h2v5h5v2h2v2h-5v5H9v2H7v-5H2V9H0V7h5V2h2z"/>',
  clean: '<path fill="#a9d3cb" d="M7 1h2v3h2v3h2v6h-2v2H5v-2H3V7h2V4h2z"/><path fill="#e7eee0" d="M5 8h2v4H5z"/>',
  vial: '<path fill="#c0cbbb" d="M5 1h6v3H9v3h3v7H4V7h3V4H5z"/><path fill="#79c7b5" d="M5 9h6v4H5z"/>',
  arrow: '<path fill="#e9c489" d="M2 7h7V3h2v2h2v2h2v2h-2v2h-2v2H9V9H2z"/>',
  close: '<path fill="#e5ccb0" d="M3 2l5 5 5-5 2 2-5 5 5 5-2 2-5-5-5 5-2-2 5-5-5-5z"/>'
};
export function icon(name) { return `<svg class="pixel-icon" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges">${PATHS[name] || PATHS.star}</svg>`; }

export function workshopBackground() {
  const canvas = surface(384, 256), ctx = canvas.getContext('2d'), rng = mulberry32(6129);
  const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  rect(0, 0, 384, 256, '#302633');
  for (let y = 0; y < 224; y += 20) for (let x = -24 + (y % 40 ? 20 : 0); x < 384; x += 40) {
    rect(x + 1, y + 1, 38, 18, ['#3e303b', '#40323e', '#45343e'][Math.floor(rng() * 3)]);
    rect(x + 3, y + 2, 30, 1, '#51404a');
    if (rng() > .55) rect(x + 24, y + 12, 8, 2, '#352934');
  }
  rect(10, 0, 12, 220, '#211e2b'); rect(12, 0, 4, 220, '#614333'); rect(364, 0, 12, 220, '#211e2b'); rect(366, 0, 4, 220, '#614333');
  rect(126, 8, 132, 62, '#261f2e'); rect(132, 12, 120, 54, '#736048'); rect(136, 16, 112, 46, '#31374c');
  rect(143, 23, 98, 38, '#38485d'); rect(176, 16, 4, 46, '#9d8053'); rect(210, 16, 4, 46, '#9d8053'); rect(136, 35, 112, 4, '#9d8053');
  rect(146, 25, 3, 3, '#e3d29e'); rect(219, 18, 3, 3, '#e3d29e'); rect(201, 47, 3, 3, '#8ea3bd');
  rect(12, 61, 108, 10, '#271e29'); rect(16, 61, 104, 4, '#bc8553'); rect(16, 65, 104, 4, '#825337');
  rect(264, 61, 108, 10, '#271e29'); rect(264, 61, 104, 4, '#bc8553'); rect(264, 65, 104, 4, '#825337');
  const tinyBottle = (x, y, colour) => { rect(x + 4, y, 6, 4, '#d1a266'); rect(x + 4, y + 4, 6, 6, '#bacbbf'); rect(x, y + 10, 14, 18, '#423446'); rect(x + 2, y + 12, 10, 14, colour); rect(x + 2, y + 12, 2, 8, '#ddd8b5'); };
  ['#8da8c0', '#929650', '#cb7870', '#9785b5'].forEach((c, i) => tinyBottle(24 + i * 23, 31, c));
  ['#7cbdab', '#d9af60', '#aa82b2', '#91c2c5'].forEach((c, i) => tinyBottle(269 + i * 23, 31, c));
  for (const x of [32, 348]) { rect(x - 6, 90, 12, 6, '#b68b4f'); rect(x - 2, 71, 4, 19, '#f5d79c'); rect(x - 4, 69, 8, 3, '#f1c276'); rect(x - 2, 61, 4, 8, '#efa357'); rect(x, 62, 2, 5, '#fff0b1'); }
  rect(0, 216, 384, 40, '#261e2a');
  for (let y = 218; y < 256; y += 12) { rect(0, y, 384, 10, y % 24 ? '#6c4435' : '#78503a'); rect(0, y, 384, 2, '#a3764c'); for (let x = 6; x < 384; x += 32) rect(x, y + 6, 17, 1, '#57382f'); }
  rect(28, 182, 33, 31, '#382b34'); rect(30, 184, 29, 3, '#b48a60'); rect(32, 189, 25, 21, '#795543');
  rect(319, 184, 32, 28, '#312c38'); rect(321, 187, 28, 22, '#6b5a71'); rect(328, 191, 14, 14, '#8eb6ba'); rect(330, 193, 5, 8, '#c1dede');
  return canvas;
}
