import { mulberry32 } from '../materials/MaterialGenerator.mjs';

// All artwork is original: small, reusable pixel sprites and a seeded workshop.
// No external fonts, stock images, emoji, downloads or runtime art dependencies.
const cache = new Map();
function surface(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

/** Tiny reusable lights; building the falloff once keeps particle drawing cheap. */
export function magicGlowSprite(colour) {
  const key = `glow:${colour}`; if (cache.has(key)) return cache.get(key);
  const canvas = surface(20, 20), ctx = canvas.getContext('2d');
  ctx.fillStyle = colour;
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
    const distance = Math.hypot(x - 9.5, y - 9.5) / 10;
    if (distance >= 1) continue;
    ctx.globalAlpha = (1 - distance) ** 2;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1; cache.set(key, canvas); return canvas;
}

/** Raw gatherables share the 24×32 rack contract with the original bottles. */
export function ingredientSprite(ingredient) {
  const colour = ingredient.material?.color || '#8dce99', style = Number(ingredient.id) || 0;
  const form = ingredient.form || 'water';
  if (form === 'water' || form === 'liquid') return bottleSprite(colour, style);
  if (form === 'powder') return powderSprite(colour, style);
  const key = `ingredient:${form}:${colour}:${style}`; if (cache.has(key)) return cache.get(key);
  const canvas = surface(24, 32), ctx = canvas.getContext('2d');
  const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  // A small grounding shadow makes loose plants and minerals feel substantial.
  rect(4, 29, 16, 2, '#2d2837');
  if (form === 'stone') {
    rect(6, 11, 12, 3, '#302b3f'); rect(3, 14, 18, 12, '#302b3f'); rect(6, 26, 13, 3, '#302b3f');
    rect(7, 13, 9, 3, colour); rect(5, 16, 14, 9, colour); rect(7, 25, 10, 2, colour);
    rect(7, 14, 8, 2, '#e1d5c1'); rect(5, 16, 2, 5, '#e1d5c1');
    rect(14, 20, 5, 5, '#687080'); rect(11, 24, 6, 2, '#687080');
    if (style % 2) { rect(12, 17, 2, 5, '#e3c58a'); rect(10, 19, 6, 2, '#e3c58a'); }
    else { rect(9, 18, 2, 2, '#41364c'); rect(15, 16, 2, 2, '#41364c'); }
  } else if (form === 'mushroom') {
    rect(10, 17, 5, 11, '#332c3c'); rect(11, 19, 3, 8, '#dfc5a1'); rect(13, 20, 2, 6, '#ae906e');
    rect(7, 7, 10, 3, '#332c3c'); rect(4, 10, 16, 4, '#332c3c'); rect(2, 14, 20, 5, '#332c3c');
    rect(8, 9, 8, 3, colour); rect(5, 12, 14, 4, colour); rect(4, 16, 16, 2, colour);
    rect(4, 18, 16, 2, '#e6c4a0'); rect(7, 11, 3, 2, '#ffe2bd'); rect(15, 14, 3, 2, '#ffe2bd');
    rect(10, 15, 2, 2, '#ffe2bd'); rect(8, 28, 9, 2, '#8b7754');
  } else {
    rect(11, 10, 3, 17, '#303e32'); rect(12, 11, 1, 15, '#a7b96e');
    rect(3, 15, 8, 3, '#303e32'); rect(5, 18, 8, 3, '#303e32');
    rect(14, 9, 7, 3, '#303e32'); rect(13, 12, 6, 3, '#303e32');
    rect(4, 15, 7, 2, '#77a768'); rect(7, 18, 5, 2, '#77a768');
    rect(14, 10, 6, 2, '#93bf72'); rect(13, 13, 4, 2, '#93bf72');
    rect(10, 25, 5, 3, '#b89a6b'); rect(8, 28, 4, 2, '#b89a6b'); rect(15, 28, 3, 2, '#b89a6b');
    const bloom = style % 3;
    if (bloom === 0) {
      rect(9, 3, 7, 8, '#303e32'); rect(7, 5, 11, 4, '#303e32');
      rect(10, 4, 5, 6, colour); rect(8, 6, 9, 2, colour); rect(11, 6, 3, 2, '#ffe3a0');
    } else if (bloom === 1) {
      rect(10, 3, 6, 7, '#303e32'); rect(11, 4, 4, 5, colour); rect(11, 3, 1, 2, '#d9e3b5');
    } else {
      rect(8, 6, 4, 4, colour); rect(14, 4, 4, 4, colour); rect(11, 10, 4, 3, colour);
      rect(9, 6, 1, 1, '#f3d6b1'); rect(15, 4, 1, 1, '#f3d6b1');
    }
  }
  const url = canvas.toDataURL(); cache.set(key, url); return url;
}
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

export function powderSprite(colour = '#dfcb91', style = 0) {
  const key = `powder:${colour}:${style}`; if (cache.has(key)) return cache.get(key);
  const canvas = surface(24, 32), ctx = canvas.getContext('2d');
  const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  rect(4, 5, 16, 5, '#38283b'); rect(5, 6, 14, 3, '#b78a54');
  rect(3, 10, 18, 20, '#362e47'); rect(4, 11, 16, 17, '#7d8b97');
  rect(5, 18, 14, 10, colour); rect(7, 16, 10, 2, colour); rect(9, 14, 6, 2, colour);
  for (let n = 0; n < 9; n++) rect(6 + (n * 5 + style) % 12, 19 + (n * 3) % 8, 1, 1, '#79685e');
  rect(5, 12, 2, 5, '#d4eee7'); rect(9, 20, 7, 4, '#d9c49a');
  rect(10, 21, 1, 1, '#6f5144'); rect(13, 22, 1, 1, '#6f5144'); rect(14, 21, 1, 1, '#6f5144');
  const url = canvas.toDataURL(); cache.set(key, url); return url;
}

/** A seeded woodland is baked once; harvesting UI can sit above this still art. */
export function naturalLandscapeSprite(seed = 6129) {
  const key = `landscape:${seed}`; if (cache.has(key)) return cache.get(key);
  let number = 2166136261; for (const c of String(seed)) number = Math.imul(number ^ c.charCodeAt(0), 16777619);
  const canvas = surface(384, 160), ctx = canvas.getContext('2d'), rng = mulberry32(number >>> 0);
  const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  rect(0, 0, 384, 160, '#253b4c'); rect(0, 36, 384, 43, '#304d54');
  rect(293, 13, 15, 15, '#e4e5bf'); rect(298, 10, 8, 21, '#e4e5bf'); rect(304, 11, 9, 17, '#253b4c');
  for (let i = 0; i < 30; i++) rect(Math.floor(rng() * 384), Math.floor(rng() * 63), 1, 1, '#a2b9ae');
  // Three fixed-depth tree layers give the glade a clear, spacious center.
  for (let x = -12; x < 400; x += 27) {
    const top = 23 + Math.floor(rng() * 24);
    rect(x + 8, top, 8, 77 - top, '#284b4b'); rect(x, top + 13, 25, 43, '#284b4b');
    rect(x + 9, top + 16, 3, 64 - top, '#345856');
  }
  rect(0, 73, 384, 22, '#3f6351'); rect(0, 87, 384, 73, '#567451');
  for (let i = 0; i < 135; i++) {
    const x = Math.floor(rng() * 192) * 2, y = 91 + Math.floor(rng() * 33) * 2;
    rect(x, y, 2 + Math.floor(rng() * 3) * 2, 2, rng() > .5 ? '#648052' : '#496d50');
  }
  // Water remains the visibly plain fluid among the raw woodland ingredients.
  for (let y = 79; y < 160; y += 2) {
    const bend = Math.round(212 + Math.sin((y - 79) / 30) * 28 - (y - 79) * .28), width = 11 + (y - 79) * .44;
    rect(bend - 4, y, width + 8, 2, '#394e49'); rect(bend, y, width, 2, '#79aeb3');
    if (y % 10 === 1) rect(bend + 4, y, width * .5, 1, '#acd5cd');
  }
  for (const x of [18, 78, 326, 364]) {
    const top = Math.floor(rng() * 20), trunk = x > 200 ? '#493d36' : '#454333';
    rect(x, top + 18, 12, 101 - top, '#263e38'); rect(x + 3, top + 21, 7, 80 - top, trunk);
    rect(x - 8, 99, 28, 4, '#263e38'); rect(x - 16, top + 11, 44, 27, '#2d5143');
    rect(x - 7, top, 27, 43, '#2d5143'); rect(x - 14, top + 16, 16, 10, '#3d6448');
    rect(x + 4, top + 5, 15, 7, '#436b4b'); rect(x + 14, top + 27, 12, 5, '#436b4b');
  }
  const stone = (x, y) => { rect(x + 3, y, 16, 3, '#3c514b'); rect(x, y + 3, 23, 9, '#3c514b'); rect(x + 3, y + 2, 14, 3, '#9ba79a'); rect(x + 2, y + 5, 19, 6, '#7b9083'); rect(x + 15, y + 7, 6, 3, '#5d7569'); };
  stone(141, 98); stone(291, 132); stone(118, 137);
  for (const [x, y] of [[99, 119], [166, 144], [302, 98], [268, 120], [53, 144]]) {
    rect(x, y, 2, 9, '#2d5340'); rect(x - 4, y + 3, 5, 2, '#a1b67b'); rect(x + 2, y, 5, 2, '#a1b67b');
    rect(x - 1, y - 3, 4, 4, '#e7adad'); rect(x, y - 2, 2, 2, '#efe6a4');
  }
  for (const [x, y] of [[36, 112], [68, 124], [347, 131]]) {
    rect(x + 3, y + 4, 2, 6, '#c6b591'); rect(x, y, 8, 5, '#b284a7'); rect(x + 2, y - 2, 4, 2, '#b284a7'); rect(x + 2, y, 2, 2, '#ead3c0');
  }
  const url = canvas.toDataURL(); cache.set(key, url); return url;
}

/** A clean non-graphic visual readout accompanies the actual subject state. */
export function experimentSubjectSprite(kind, state = 'healthy') {
  const key = `subject:${kind}:${state}`; if (cache.has(key)) return cache.get(key);
  const canvas = surface(64, 56), ctx = canvas.getContext('2d');
  const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const faded = state === 'dead' || state === 'poisoned' || state === 'hurt';
  const frozen = state === 'frozen', changed = state === 'transformed';
  const outline = '#34303f', cream = frozen ? '#a7e4eb' : faded ? '#a5a294' : '#e5cfac';
  rect(11, 47, 42, 3, '#352d39'); rect(16, 50, 32, 1, '#292633');
  if (kind === 'rabbit') {
    rect(16, 28, 30, 16, outline); rect(13, 32, 6, 10, outline); rect(39, 19, 13, 20, outline);
    rect(40, 5, 5, 17, outline); rect(48, 8, 4, 15, outline);
    rect(41, 7, 3, 14, cream); rect(49, 10, 2, 12, cream);
    rect(42, 10, 1, 8, '#bf91a1'); rect(49, 12, 1, 7, '#bf91a1');
    rect(19, 29, 25, 14, cream); rect(15, 33, 8, 8, cream); rect(41, 21, 9, 15, cream);
    rect(19, 42, 12, 4, cream); rect(37, 42, 12, 4, cream); rect(10, 31, 6, 7, '#f0e3c6');
    rect(26, 31, 11, 3, '#f2e5ca'); rect(21, 42, 7, 2, '#bbac95');
    if (state === 'dead') rect(45, 25, 4, 1, outline);
    else { rect(46, 25, 2, 3, outline); rect(46, 25, 1, 1, '#fff2d4'); }
    rect(50, 31, 3, 2, '#bc8290');
    if (changed) { rect(23, 18, 8, 14, '#90d8c4'); rect(18, 19, 8, 9, '#b4e5d1'); rect(31, 23, 7, 8, '#ccbaee'); rect(26, 22, 2, 12, '#62598a'); }
  } else if (kind === 'seedling' || kind === 'plant') {
    rect(22, 39, 21, 4, '#3d2e35'); rect(24, 43, 17, 7, '#a06a4c'); rect(26, 50, 13, 3, '#754c3e');
    rect(24, 40, 17, 3, '#5b4237'); rect(28, 39, 9, 1, '#a18b58');
    rect(31, faded ? 28 : 18, 2, faded ? 13 : 23, frozen ? '#7fc9d8' : '#799360');
    const leaf = frozen ? '#a7e4eb' : faded ? '#978477' : '#9ac475';
    rect(19, faded ? 28 : 24, 12, 5, outline); rect(20, faded ? 29 : 24, 10, 3, leaf);
    rect(33, faded ? 30 : 17, 11, 5, outline); rect(33, faded ? 30 : 18, 10, 3, leaf);
    rect(24, faded ? 31 : 29, 7, 2, leaf); rect(34, faded ? 33 : 22, 6, 2, leaf);
    if (changed || state === 'strong') { rect(27, 8, 10, 11, '#f2a7c4'); rect(24, 11, 16, 5, '#f2a7c4'); rect(30, 12, 4, 4, '#e5cf72'); }
  } else if (kind === 'beetle') {
    const shell = frozen ? '#9fdfe9' : faded ? '#7b8271' : changed ? '#b79ee0' : '#91ad78';
    for (const y of [27, 34, 40]) { rect(16, y, 8, 2, outline); rect(40, y, 8, 2, outline); rect(15, y - 2, 2, 3, outline); rect(47, y - 2, 2, 3, outline); }
    rect(25, 18, 14, 6, outline); rect(22, 23, 20, 21, outline); rect(25, 43, 14, 3, outline);
    rect(24, 25, 16, 17, shell); rect(27, 43, 10, 2, shell); rect(26, 19, 12, 6, '#607456');
    rect(31, 25, 2, 19, outline); rect(26, 27, 2, 8, '#c5d79c'); rect(35, 36, 3, 3, '#5c7760');
    rect(25, 15, 2, 6, outline); rect(37, 15, 2, 6, outline); rect(23, 13, 4, 2, outline); rect(37, 13, 4, 2, outline);
    if (changed) { rect(19, 23, 7, 9, '#ceb4e9'); rect(38, 23, 7, 9, '#ceb4e9'); }
  } else {
    const stone = frozen ? '#a7e4eb' : changed ? '#9ddac0' : '#9eaaae';
    rect(22, 21, 22, 4, outline); rect(16, 25, 32, 18, outline); rect(20, 43, 25, 3, outline);
    rect(24, 23, 18, 4, stone); rect(18, 27, 28, 15, stone); rect(22, 42, 21, 2, stone);
    rect(22, 25, 13, 3, '#d4d9c8'); rect(19, 29, 3, 6, '#d4d9c8'); rect(37, 36, 9, 6, '#718087');
    if (state === 'hurt' || changed) { rect(29, 27, 2, 8, outline); rect(31, 34, 3, 2, outline); rect(32, 35, 2, 7, outline); }
    if (changed) { rect(27, 10, 7, 17, '#83cbb2'); rect(29, 7, 3, 4, '#bde7cf'); rect(35, 17, 6, 9, '#a38bd0'); }
  }
  if (frozen) { rect(13, 44, 38, 2, '#80cfdf'); rect(21, 47, 22, 2, '#bbe8eb'); }
  if (state === 'burning') { for (const x of [13, 27, 47]) { rect(x, 36, 5, 11, '#d68450'); rect(x + 2, 31, 2, 13, '#f7c773'); } }
  if (state === 'loved') { rect(11, 10, 3, 3, '#e3a0bd'); rect(16, 10, 3, 3, '#e3a0bd'); rect(11, 13, 8, 3, '#e3a0bd'); rect(13, 16, 4, 2, '#e3a0bd'); rect(14, 18, 2, 1, '#e3a0bd'); }
  if (state === 'strong') { rect(10, 17, 2, 8, '#e9c879'); rect(7, 20, 8, 2, '#e9c879'); rect(49, 11, 2, 6, '#e9c879'); rect(47, 13, 6, 2, '#e9c879'); }
  if (state === 'poisoned') { rect(11, 14, 3, 4, '#a5bc73'); rect(52, 23, 2, 3, '#a5bc73'); }
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
  leaf: '<path fill="#476848" d="M6 1h9v7h-2v3h-3v2H6v2H3v-4H1V7h2V4h3z"/><path fill="#a9c778" d="M7 3h6v4h-2v3H7V8H5V5h2z"/><path fill="#e2cf95" d="M3 12h2v-2h2V8h2V6h2V4h2v2h-2v2H9v2H7v2H5v3H3z"/>',
  flask: '<path fill="#bccbc7" d="M5 1h6v2H9v5l5 5v2H2v-2l5-5V3H5z"/><path fill="#8cbb99" d="M6 10h4l3 4H3z"/><path fill="#e3edcf" d="M4 12h2v1H4zm3-1h1v1H7z"/>',
  infinity: '<path fill="#c6b5e5" d="M2 4h4v2h2v2h2V6h2V4h3v2h1v5h-2v2h-3v-2H9V9H7v2H5v2H2v-2H0V6h2zm0 3v3h3V8H4V7zm10 0v1h-1v2h3V7z"/>',
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
