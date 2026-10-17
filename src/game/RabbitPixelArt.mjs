import { RABBIT_THRESHOLDS } from './rabbits.mjs';
import { rabbitSprite, rabbitArtwork, rabbitArtworkVersion } from './RabbitAssets.mjs';
import { rabbitAppearance } from './RabbitAppearance.mjs';
import { drawRabbitArtwork } from './RabbitArtRenderer.mjs';

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
// Paint the union of the anatomy once: one outline, broad fur highlights and
// a quiet underside, without concentric rings around every body part.
function silhouette(ctx, shapes, palette) {
  const pixels = new Set();
  for (const [x,y,rx,ry] of shapes) {
    const w=Math.max(1,Math.round(rx)),h=Math.max(1,Math.round(ry)),cx=Math.round(x),cy=Math.round(y);
    for(let row=-h;row<=h;row++) {
      const half=Math.floor(w*Math.sqrt(Math.max(0,1-(row/h)**2)));
      for(let column=-half;column<=half;column++)pixels.add(`${cx+column},${cy+row}`);
    }
  }
  const tops=new Map(),bottoms=new Map();
  for(const pixel of pixels){const [x,y]=pixel.split(',').map(Number);tops.set(x,Math.min(tops.get(x)??y,y));bottoms.set(x,Math.max(bottoms.get(x)??y,y));}
  for(const pixel of pixels){
    const [x,y]=pixel.split(',').map(Number);
    const edge=[[-1,0],[1,0],[0,-1],[0,1]].some(([dx,dy])=>!pixels.has(`${x+dx},${y+dy}`));
    const depth=(y-tops.get(x))/Math.max(1,bottoms.get(x)-tops.get(x));
    rect(ctx,x,y,1,1,edge?palette[3]:depth<.3?palette[0]:depth>.8?palette[2]:palette[1]);
  }
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
  if (drawRabbitArtwork(ctx,rabbit,x,floor,size,time,options)) return;
  if (typeof OffscreenCanvas === 'undefined') return drawRabbitPixels(ctx, rabbit, x, floor, size, time, options);
  const now = options.now ?? Date.now(), frame = rabbit.stats?.alive === false || options.reference ? 0 : Math.floor(time / 180) % 24;
  const key = JSON.stringify([rabbitArtworkVersion(), rabbit.id, rabbit.age, rabbit.stats?.growth, rabbit.stats?.alive,
    rabbit.mutation?.seed, rabbit.deathAppearance, rabbit.dangerous, rabbit.aggression,
    rabbit.exposure, Number(rabbit.activeFireUntil) > now, options.selected, options.cullMode, options.activity, options.gait, options.hop, frame]);
  let sprite = sprites.get(key);
  if (!sprite) {
    sprite = new OffscreenCanvas(224, 160);
    drawRabbitPixels(sprite.getContext('2d'), rabbit, 112, 152, 96, frame * 180, { ...options, facing: 1, now });
    if (sprites.size >= 192) sprites.delete(sprites.keys().next().value);
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
  if (!alive || options.reference) time = 0;
  const baby = rabbit.age === 'baby' || rabbit.age === 'juvenile';
  const growth = clamp((rabbit.stats?.growth || 0) / 100);
  const load = key => Math.max(0, Number(rabbit.exposure?.[key]) || 0);
  const response = key => rabbitVisualResponse(load(key), RABBIT_THRESHOLDS[key]);
  const muscle = response('strength'), acid = response('acidity'), scorch = response('fire');
  const morph = response('transformation'), love = response('love'), frost = response('freeze');
  const poison = response('poison'), death = response('death');
  const angry = rabbit.dangerous || rabbit.aggression || load('love') >= RABBIT_THRESHOLDS.love;
  const charred = rabbit.deathAppearance === 'charred';
  const appearance = rabbitAppearance(rabbit, now);
  const artwork = rabbitSprite(rabbit, poison, frost, death, charred, appearance);
  const matched = Boolean(artwork);
  const sprite = artwork || rabbitSprite(rabbit, poison, frost, death, charred);
  const secondaryMuscle = matched && appearance.secondary.includes('strength') ? muscle : 0;
  const artWidth = 96 + Math.round(secondaryMuscle * 8), artHeight = 72 + Math.round(secondaryMuscle * 4);
  const artX = -Math.round(artWidth / 2), artY = -Math.round(artHeight * 180 / 192);
  const scale = Math.max(1, Math.round(size / 48 * (baby ? .65 + growth * .25 : 1)));
  const snap = value => Math.round(value / scale) * scale;
  ctx.save(); ctx.imageSmoothingEnabled = false;
  ctx.translate(snap(x), snap(floor)); ctx.scale((options.facing === -1 ? -1 : 1) * scale, scale);
  ellipse(ctx, -1, 1, 22 + muscle * 8, 2, '#1c242d');
  if (options.selected) {
    rect(ctx, -27, 1, 5, 1, options.cullMode ? '#f19b8d' : '#ffe0a0');
    rect(ctx, 22, 1, 5, 1, options.cullMode ? '#f19b8d' : '#ffe0a0');
  }
  if (acid && !matched) {
    ellipse(ctx, -3, 1, 10 + acid * 15, 2, '#657c4a');
    if(alive)for (let i = 0; i < 3 + acid * 6; i++) rect(ctx, -20 + rand(50 + i) * 35, -1 - (Math.floor(time / 180) + i * 3) % 8, 2, 2, '#bdcf7c');
  }
  if (!alive && rabbit.deathAppearance === 'dissolved') {
    ellipse(ctx, -4, 0, 18, 2, '#b2977b'); rect(ctx, -11, -1, 4, 1, '#e6ccaa'); ctx.restore(); return;
  }
  const breath = alive && !frost ? Math.round(Math.sin(time * .004 + seed) * .55) : 0;
  const shake = alive && (poison || frost) ? Math.round(Math.sin(time * .035) * Math.max(poison, frost)) : 0;
  ctx.translate(shake, -breath - (alive ? Number(options.hop) || 0 : 0));
  // Corrosion and terminal collapse change integer geometry rather than scaling
  // the grid, so even dying and dissolving specimens retain crisp pixel edges.
  const erosion = Math.max(.42, 1 - Math.max(0, acid - .4) * .85);
  // Death does not resize the final effect silhouette. Lowered posture is a
  // rigid tilt, while the original fur pixels and anatomical ratios survive.
  if (!alive) ctx.rotate(.12);
  const y = value => Math.round(value * erosion);
  const palette = palettes[seed % palettes.length].map(color => {
    const affected = charred ? mixColor(color, '#29242f', .88) : mixColor(mixColor(mixColor(color, '#94b46e', poison * .5), '#a6dce9', frost * .45), '#746485', death * .45);
    return alive ? affected : mixColor(affected, '#686676', charred ? .2 : .34);
  });
  const back = y(-14 - muscle * 3), headX = Math.round(14 + morph * (rand(1) * 8 - 2));
  const grazing = alive && options.activity === 'graze', sniffing = alive && options.activity === 'sniff';
  const headY = y(-25 - muscle * 3 + poison * 5 + (grazing ? 9 : sniffing ? 2 : 0));
  const haunch = Math.round((9 + muscle * 10) * erosion), shoulder = Math.round((6 + muscle * 10) * erosion);
  const ear1 = Math.round((baby ? 11 : 15) + morph * (rand(2) * 18 - 4));
  const ear2 = Math.round((baby ? 10 : 14) + morph * (rand(3) * 20 - 5));
  const tucked = alive && options.gait === 1 ? 3 : 0;
  if (sprite) {
    if (matched) {
      // All supplied layers share the 256x192 canvas and (128,180) pivot.
      // Preserve that aspect/pivot instead of stretching each animal's bounds.
      ctx.drawImage(sprite, artX, artY, artWidth, artHeight);
    } else {
      const height = Math.max(1, -y(-45 - muscle * 8) - (grazing ? 4 : sniffing ? 1 : 0));
      ctx.drawImage(sprite, Math.round((-27 - muscle * 9) * erosion), -height,
        Math.round((54 + muscle * 18) * erosion), height);
    }
  } else {
    silhouette(ctx,[
    [-22-muscle*3,y(-13),4+morph*3,Math.max(2,y(5))],
    [-5,back,(15+muscle*4)*erosion,Math.max(3,y(10+muscle*4))],
    [-12-muscle*2,y(-11-muscle*3),haunch,Math.max(3,y(10+muscle*7))],
    [8+muscle*3,y(-15-muscle*3),shoulder,Math.max(3,y(8+muscle*7))],
    [13+muscle*4-tucked,y(-6)-tucked,3+muscle*5,Math.max(2,y(6))],
    [headX,headY,Math.max(5,(8+morph*3)*erosion),Math.max(4,y(8))],
    [headX+6,headY+y(3),5,Math.max(2,y(3))],
    [headX+3,headY-ear2/2,2,ear2/2+2],
    [headX-2,headY-ear1/2-1,3,ear1/2+2]
  ],palette);
  // A single haunch seam and two paws read cleanly even at pen scale.
  rect(ctx,-12,y(-9),2,3,palette[2]);
  rect(ctx, -19 - muscle * 3, -2, 17 + muscle * 7, 3, palette[3]); rect(ctx, -17 - muscle * 3, -2, 14 + muscle * 7, 2, palette[0]);
  rect(ctx, 10 + muscle * 3 - tucked, -2-tucked, 11 + muscle * 4, 3, palette[3]); rect(ctx, 11 + muscle * 3 - tucked, -2-tucked, 9 + muscle * 4, 2, palette[0]);
  }
  if (muscle && !matched) {
    rect(ctx, -13 - muscle * 2, y(-13 - muscle * 5), 1, 4 + muscle * 3, palette[3]);
    rect(ctx, 8 + muscle * 3, y(-18 - muscle * 4), 1, 4 + muscle * 4, palette[3]);
    rect(ctx, 11 + muscle * 4, y(-6), 2 + muscle * 3, 1, palette[3]);
  }
  // Seeded color patches, tissue loss, burns and ice grow in place across doses.
  for (let i = 0; i < 18; i++) {
    const px = -19 + rand(100 + i) * 30, py = y(-21 + rand(140 + i) * 16);
    if (acid && !matched && rand(220 + i) < acid) {
      rect(ctx, px, py, 2 + acid * 4, 1 + acid * 3, '#bd8b79');
      if (acid > .45) rect(ctx, px + 1, py + 1, 1 + acid * 3, 1 + acid * 2, '#7d5457');
    }
    if (scorch && !matched && rand(260 + i) < scorch) rect(ctx, px, py, 2 + scorch * 3, 2, charred ? '#1f1e28' : '#5b423d');
    if (frost && rand(300 + i) < frost) spark(ctx, px, py, '#e6fbff', frost > .65 ? 2 : 1);
    if (morph && !matched && rand(340 + i) < morph * .6) rect(ctx, px, py, 2, 2, '#bd91cc');
  }
  // Transformation is anatomical from the first dose: asymmetric ears, forehead
  // growth and seeded back spines, then additional limbs at high exposure.
  if (morph && !matched) {
    for (let i = 0; i < 3 + rand(4) * 3; i++) {
      const sx = -16 + i * 6, height = Math.round(2 + morph * (5 + rand(5 + i) * 10));
      for (let row = 0; row < height; row++) rect(ctx, sx + Math.floor(row / 3), back - y(9) - row, Math.max(1, 4 - Math.floor(row / 3)), 1, i % 2 ? '#b895c8' : '#80678e');
    }
    if (morph > .5) { rect(ctx, -1, y(-13), 3, 12 + morph * 8, '#9b77ac'); rect(ctx, -3, -1, 6, 2, '#d4b5cb'); }
  }
  // Pink interiors, bright cheeks and a quiet muzzle finish the clean silhouette.
  if (!sprite) {
  rect(ctx, headX - 2, headY - ear1 + 2, 2, ear1 - 5, frost ? '#c3edfa' : '#cf9794');
  rect(ctx, headX - 3, headY - ear1 - 1, 3, 1, palette[0]);
  rect(ctx, headX+2,headY+2,7,2,palette[0]);
  }
  if (love && (!matched || angry)) rect(ctx, headX + 1, headY + 3, 3 + love * 2, 2, angry ? '#c26069' : '#eea7b0');
  const eye = angry ? '#e96565' : death > .6 ? '#c4b6cd' : '#252635';
  if (alive && !matched && (grazing || Math.floor(time/180)%24===20)) rect(ctx,headX+2,headY-2,3,1,eye);
  else if (alive && (!sprite || angry || death > .6)) {
    rect(ctx, headX + 2, headY - 3, 2 + morph * 2, 3, eye);
    rect(ctx, headX + 2, headY - 3, 1, 1, '#fff4da');
  } else if (!alive) { rect(ctx, headX + 2, headY, 3, 1, '#3a303c'); }
  if (!sprite) {
  rect(ctx, headX + 10, headY + 2, 2, 2, angry ? '#843e52' : '#ae777a');
  rect(ctx, headX + 7, headY + 5, 2, 1, palette[3]);
  rect(ctx, headX + 9, headY + 6, 5, 1, palette[0]);
  }
  if (morph && !matched) { rect(ctx, headX - 1, headY - 9, 2 + morph * 3, 3 + morph * 4, '#b794c6'); }
  if (frost) { spark(ctx, headX - 3, headY - ear1 + 4, '#e6fbff'); rect(ctx, -10, -2, 3 + frost * 10, 2, '#a5d9e6'); }
  if (poison && !matched) { rect(ctx, headX + 4, headY + 6, 2, 4 + poison * 3, '#88b76b'); spark(ctx, -25, -21, '#b4d883', 1); }
  if (alive && scorch && Number(rabbit.activeFireUntil) > now && !matched) {
    for (let i = 0; i < 2 + scorch * 6; i++) flame(ctx, -17 + i * 7, y(-20), 5 + scorch * 17 + rand(400 + i) * 5, time * .012 + i);
  }
  if (alive && love && !matched) {
    for (let i = 0; i < 1 + Math.floor(love * 4); i++) {
      const rise = (Math.floor(time / 130) + i * 5) % 13;
      if (angry) spark(ctx, -18 + i * 10, -40 - rise, '#ec8a78', 2);
      else heart(ctx, -20 + i * 10, -40 - rise, 1, i % 2 ? '#d979a0' : '#f4b0c4');
    }
  }
  if (alive && death) {
    for (let i = 0; i < 3 + death * 5; i++) {
      const rise = (Math.floor(time / 140) + i * 3) % 18;
      rect(ctx, -22 + i * 7, -22 - rise, 2, 2 + death * 3, i % 2 ? '#9a8bb5' : '#504563');
    }
  }
  if (matched) for (const overlay of appearance.overlays) {
    const layer = rabbitArtwork(overlay.key);
    if (layer) ctx.drawImage(layer, artX, artY, artWidth, artHeight);
  }
  ctx.restore();
}
