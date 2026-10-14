import { RABBIT_THRESHOLDS } from './rabbits.mjs';

const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
// A perceptual curve makes the first dilute dose legible. Exposure, damage and
// overdose thresholds remain in the simulation; later doses still grow the art.
export const visualResponse = value => value <= .003 ? 0 : Math.pow(clamp(value), .36);
export function rabbitVisualResponse(load, threshold = 1) {
  return load <= .003 ? 0 : Math.pow(clamp(load / threshold), .36);
}
const randomAt = (seed, index) => {
  let value = (seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  value = Math.imul(value ^ value >>> 16, 0x21f0aaad);
  value = Math.imul(value ^ value >>> 15, 0x735a2d97);
  return ((value ^ value >>> 15) >>> 0) / 4294967296;
};
const palettes = [
  ['#f4e5be', '#d7bf92', '#ab8b65', '#705443'],
  ['#e1dfd3', '#bab9b2', '#8c9096', '#565762'],
  ['#ead0af', '#bf946d', '#936647', '#583d38'],
  ['#fff1d9', '#e4d8c7', '#b4aaa6', '#766879']
];
const mixColor = (base, tint, amount) => {
  const a = Number.parseInt(base.slice(1), 16), b = Number.parseInt(tint.slice(1), 16);
  return '#' + [16, 8, 0].map(shift => Math.round(((a >> shift) & 255) * (1 - amount) + ((b >> shift) & 255) * amount).toString(16).padStart(2, '0')).join('');
};

// Every shape is assembled from integer grid cells, with a small flat palette.
// No smooth paths, gradients or filtered enlargement enter the rabbit sprite.
function rect(ctx, x, y, width, height, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
}
function ellipse(ctx, x, y, rx, ry, color) {
  rx = Math.max(1, Math.round(rx)); ry = Math.max(1, Math.round(ry));
  for (let row = -ry; row <= ry; row++) {
    const half = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (row / ry) ** 2)));
    rect(ctx, x - half, y + row, half * 2 + 1, 1, color);
  }
}
function mass(ctx, x, y, rx, ry, palette) {
  ellipse(ctx, x, y, rx + 1, ry + 1, palette[3]);
  ellipse(ctx, x, y, rx, ry, palette[2]);
  ellipse(ctx, x - 1, y - 1, Math.max(1, rx - 1), Math.max(1, ry - 1), palette[1]);
  rect(ctx, x - rx / 2, y - ry + 1, Math.max(2, rx), 1, palette[0]);
}
function heart(ctx, x, y, scale = 1, color = '#f2a6bc') {
  for (const [row, pattern] of ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'].entries()) {
    for (let column = 0; column < pattern.length; column++) if (pattern[column] === '1') rect(ctx, x + column * scale, y + row * scale, scale, scale, color);
  }
}
function spark(ctx, x, y, color, size = 2) {
  rect(ctx, x, y - size, 1, size * 2 + 1, color); rect(ctx, x - size, y, size * 2 + 1, 1, color);
}
function flame(ctx, x, y, height, phase) {
  height = Math.max(4, Math.round(height));
  for (let row = 0; row < height; row++) {
    const width = Math.max(1, Math.floor((height - row) * .35));
    const sway = Math.round(Math.sin(phase + row * .4) * row * .13);
    rect(ctx, x - width + sway, y - row, width * 2 + 1, 1, row > height * .6 ? '#e66a47' : '#f7ae55');
    if (row < height * .55) rect(ctx, x - 1, y - row, 3, 1, '#ffe4a2');
  }
}

const sprites = new Map();
/** Cache native pixel sprites so a full colony costs one blit per rabbit, rather
 * than hundreds of tiny canvas calls per animal on each phone display frame. */
export function drawPixelRabbit(ctx, rabbit, x, floor, size, time = 0, options = {}) {
  if (!ctx || !rabbit) return;
  if (typeof OffscreenCanvas === 'undefined') return drawRabbitPixels(ctx, rabbit, x, floor, size, time, options);
  const now = options.now ?? Date.now(), frame = Math.floor(time / 130) % 256;
  const key = JSON.stringify([rabbit.id, rabbit.age, rabbit.stats?.growth, rabbit.stats?.alive,
    rabbit.mutation?.seed, rabbit.deathAppearance, rabbit.dangerous, rabbit.aggression,
    rabbit.exposure, Number(rabbit.activeFireUntil) > now, options.selected, options.cullMode, frame]);
  let sprite = sprites.get(key);
  if (!sprite) {
    sprite = new OffscreenCanvas(448, 320);
    drawRabbitPixels(sprite.getContext('2d'), rabbit, 224, 304, 192, frame * 130, { ...options, facing: 1, now });
    if (sprites.size >= 64) sprites.delete(sprites.keys().next().value);
    sprites.set(key, sprite);
  }
  const scale = Math.max(1, Math.round(size / 48));
  ctx.save(); ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(x / scale) * scale, Math.round(floor / scale) * scale);
  ctx.scale(options.facing === -1 ? -1 : 1, 1);
  ctx.drawImage(sprite, -56 * scale, -76 * scale, 112 * scale, 80 * scale); ctx.restore();
}

/** Stable procedural pixel anatomy, rendered on a 48-cell body grid. */
function drawRabbitPixels(ctx, rabbit, x, floor, size, time = 0, options = {}) {
  if (!ctx || !rabbit) return;
  const seed = Number(rabbit.mutation?.seed) || Number(String(rabbit.id || '').replace(/\D/g, '')) || 1;
  const rand = index => randomAt(seed, index);
  const now = options.now ?? Date.now(), alive = rabbit.stats?.alive !== false;
  const baby = rabbit.age === 'baby' || rabbit.age === 'juvenile';
  const growth = clamp((rabbit.stats?.growth || 0) / 100);
  const load = key => Math.max(0, Number(rabbit.exposure?.[key]) || 0);
  const response = key => rabbitVisualResponse(load(key), RABBIT_THRESHOLDS[key]);
  const muscle = response('strength'), acid = response('acidity'), scorch = response('fire');
  const morph = response('transformation'), love = response('love'), frost = response('freeze');
  const poison = response('poison'), death = response('death');
  const angry = rabbit.dangerous || rabbit.aggression || load('love') >= RABBIT_THRESHOLDS.love;
  const charred = rabbit.deathAppearance === 'charred';
  const scale = Math.max(1, Math.round(size / 48 * (baby ? .61 + growth * .27 : 1)));
  const snap = value => Math.round(value / scale) * scale;
  ctx.save(); ctx.imageSmoothingEnabled = false;
  ctx.translate(snap(x), snap(floor)); ctx.scale((options.facing === -1 ? -1 : 1) * scale, scale);
  ellipse(ctx, -1, 1, 22 + muscle * 8, 2, '#1c242d');
  if (options.selected) {
    rect(ctx, -27, 1, 5, 1, options.cullMode ? '#f19b8d' : '#ffe0a0');
    rect(ctx, 22, 1, 5, 1, options.cullMode ? '#f19b8d' : '#ffe0a0');
  }
  if (acid) {
    ellipse(ctx, -3, 1, 10 + acid * 15, 2, '#657c4a');
    for (let i = 0; i < 3 + acid * 6; i++) rect(ctx, -20 + rand(50 + i) * 35, -1 - (Math.floor(time / 180) + i * 3) % 8, 2, 2, '#bdcf7c');
  }
  if (!alive && rabbit.deathAppearance === 'dissolved') {
    ellipse(ctx, -4, 0, 18, 2, '#b2977b'); rect(ctx, -11, -1, 4, 1, '#e6ccaa'); ctx.restore(); return;
  }
  const breath = alive && !frost ? Math.round(Math.sin(time * .004 + seed) * .55) : 0;
  const shake = alive && (poison || frost) ? Math.round(Math.sin(time * .035) * Math.max(poison, frost)) : 0;
  ctx.translate(shake, -breath);
  // Corrosion and terminal collapse change integer geometry rather than scaling
  // the grid, so even dying and dissolving specimens retain crisp pixel edges.
  const erosion = Math.max(.42, 1 - Math.max(0, acid - .4) * .85);
  const collapse = alive ? 1 : .55;
  const y = value => Math.round(value * erosion * collapse);
  const palette = palettes[seed % palettes.length].map(color =>
    charred ? mixColor(color, '#29242f', .88) : mixColor(mixColor(mixColor(color, '#94b46e', poison * .5), '#a6dce9', frost * .45), '#746485', death * .45));
  const back = y(-14 - muscle * 3), headX = Math.round(14 + morph * (rand(1) * 8 - 2));
  const headY = y(-25 - muscle * 3 + poison * 5);
  const haunch = Math.round((9 + muscle * 10) * erosion), shoulder = Math.round((6 + muscle * 10) * erosion);
  const ear1 = Math.round((baby ? 11 : 15) + morph * (rand(2) * 18 - 4));
  const ear2 = Math.round((baby ? 10 : 14) + morph * (rand(3) * 20 - 5));
  // Far legs, ears and tail sit behind the torso.
  mass(ctx, -7, y(-5), 6 + muscle * 4, Math.max(2, y(7)), [palette[2], palette[2], palette[3], palette[3]]);
  rect(ctx, headX + 1, headY - ear2, 4, ear2, palette[3]); rect(ctx, headX + 2, headY - ear2 + 2, 2, ear2 - 3, palette[2]);
  mass(ctx, -22 - muscle * 3, y(-13), 4 + morph * 3, Math.max(2, y(5)), palette);
  mass(ctx, -5, back, (15 + muscle * 4) * erosion, Math.max(3, y(10 + muscle * 4)), palette);
  ellipse(ctx, -3, y(-9), (11 + muscle * 4) * erosion, Math.max(2, y(5)), palette[0]);
  mass(ctx, -12 - muscle * 2, y(-11 - muscle * 3), haunch, Math.max(3, y(10 + muscle * 7)), palette);
  mass(ctx, 8 + muscle * 3, y(-15 - muscle * 3), shoulder, Math.max(3, y(8 + muscle * 7)), palette);
  mass(ctx, 13 + muscle * 4, y(-6), 3 + muscle * 5, Math.max(2, y(7)), palette);
  rect(ctx, -19 - muscle * 3, -2, 17 + muscle * 7, 3, palette[3]); rect(ctx, -17 - muscle * 3, -2, 14 + muscle * 7, 2, palette[0]);
  rect(ctx, 10 + muscle * 3, -2, 11 + muscle * 4, 3, palette[3]); rect(ctx, 11 + muscle * 3, -2, 9 + muscle * 4, 2, palette[0]);
  if (muscle) {
    rect(ctx, -13 - muscle * 2, y(-13 - muscle * 5), 1, 4 + muscle * 3, palette[3]);
    rect(ctx, 8 + muscle * 3, y(-18 - muscle * 4), 1, 4 + muscle * 4, palette[3]);
    rect(ctx, 11 + muscle * 4, y(-6), 2 + muscle * 3, 1, palette[3]);
  }
  // Seeded color patches, tissue loss, burns and ice grow in place across doses.
  for (let i = 0; i < 18; i++) {
    const px = -19 + rand(100 + i) * 30, py = y(-21 + rand(140 + i) * 16);
    if (rand(180 + i) < .28) rect(ctx, px, py, 2, 1, palette[2]);
    if (acid && rand(220 + i) < acid) {
      rect(ctx, px, py, 2 + acid * 4, 1 + acid * 3, '#bd8b79');
      if (acid > .45) rect(ctx, px + 1, py + 1, 1 + acid * 3, 1 + acid * 2, '#7d5457');
    }
    if (scorch && rand(260 + i) < scorch) rect(ctx, px, py, 2 + scorch * 3, 2, charred ? '#1f1e28' : '#5b423d');
    if (frost && rand(300 + i) < frost) spark(ctx, px, py, '#e6fbff', frost > .65 ? 2 : 1);
    if (morph && rand(340 + i) < morph * .6) rect(ctx, px, py, 2, 2, '#bd91cc');
  }
  // Transformation is anatomical from the first dose: asymmetric ears, forehead
  // growth and seeded back spines, then additional limbs at high exposure.
  if (morph) {
    for (let i = 0; i < 3 + rand(4) * 3; i++) {
      const sx = -16 + i * 6, height = Math.round(2 + morph * (5 + rand(5 + i) * 10));
      for (let row = 0; row < height; row++) rect(ctx, sx + Math.floor(row / 3), back - y(9) - row, Math.max(1, 4 - Math.floor(row / 3)), 1, i % 2 ? '#b895c8' : '#80678e');
    }
    if (morph > .5) { rect(ctx, -1, y(-13), 3, 12 + morph * 8, '#9b77ac'); rect(ctx, -3, -1, 6, 2, '#d4b5cb'); }
  }
  mass(ctx, headX, headY, Math.max(5, (7 + morph * 3) * erosion), Math.max(4, y(8)), palette);
  // A stepped ear silhouette with a contrasting pink interior.
  rect(ctx, headX - 3, headY - ear1 - 2, 4, ear1, palette[3]);
  rect(ctx, headX - 4, headY - ear1 + 1, 5, ear1 - 3, palette[1]);
  rect(ctx, headX - 2, headY - ear1 + 2, 2, ear1 - 5, frost ? '#c3edfa' : '#cf9794');
  rect(ctx, headX - 3, headY - ear1 - 1, 3, 1, palette[0]);
  mass(ctx, headX + 6, headY + y(3), 5, Math.max(2, y(3)), palette);
  if (love) rect(ctx, headX + 1, headY + 3, 3 + love * 2, 2, angry ? '#c26069' : '#eea7b0');
  const eye = angry ? '#e96565' : death > .6 ? '#c4b6cd' : '#252635';
  if (alive) {
    rect(ctx, headX + 2, headY - 3, 2 + morph * 2, 3, eye);
    rect(ctx, headX + 2, headY - 3, 1, 1, '#fff4da');
  } else { rect(ctx, headX + 2, headY, 3, 1, '#3a303c'); }
  rect(ctx, headX + 10, headY + 2, 2, 2, angry ? '#843e52' : '#ae777a');
  rect(ctx, headX + 7, headY + 5, 2, 1, palette[3]);
  rect(ctx, headX + 9, headY + 6, 5, 1, palette[0]);
  if (morph) { rect(ctx, headX - 1, headY - 9, 2 + morph * 3, 3 + morph * 4, '#b794c6'); }
  if (frost) { spark(ctx, headX - 3, headY - ear1 + 4, '#e6fbff'); rect(ctx, -10, -2, 3 + frost * 10, 2, '#a5d9e6'); }
  if (poison) { rect(ctx, headX + 4, headY + 6, 2, 4 + poison * 3, '#88b76b'); spark(ctx, -25, -21, '#b4d883', 1); }
  if (scorch && Number(rabbit.activeFireUntil) > now) {
    for (let i = 0; i < 2 + scorch * 6; i++) flame(ctx, -17 + i * 7, y(-20), 5 + scorch * 17 + rand(400 + i) * 5, time * .012 + i);
  }
  if (love) {
    for (let i = 0; i < 1 + Math.floor(love * 4); i++) {
      const rise = (Math.floor(time / 130) + i * 5) % 13;
      if (angry) spark(ctx, -18 + i * 10, -40 - rise, '#ec8a78', 2);
      else heart(ctx, -20 + i * 10, -40 - rise, 1, i % 2 ? '#d979a0' : '#f4b0c4');
    }
  }
  if (death) {
    for (let i = 0; i < 3 + death * 5; i++) {
      const rise = (Math.floor(time / 140) + i * 3) % 18;
      rect(ctx, -22 + i * 7, -22 - rise, 2, 2 + death * 3, i % 2 ? '#9a8bb5' : '#504563');
    }
  }
  ctx.restore();
}
