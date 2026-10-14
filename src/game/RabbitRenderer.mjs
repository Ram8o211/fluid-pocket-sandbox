// Rabbit anatomy is drawn from the accumulated dose, rather than choosing a
// sprite for the most recent potion. Every mark and mutation has a stable seed.
const TAU = Math.PI * 2;
const clamp = (value, max = 1) => Math.max(0, Math.min(max, Number(value) || 0));
const lerp = (a, b, t) => a + (b - a) * t;
const hash = value => {
  let result = 2166136261;
  for (const character of String(value)) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
};
const randomAt = (seed, index) => {
  let result = (seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  result = Math.imul(result ^ result >>> 16, 0x21f0aaad);
  result = Math.imul(result ^ result >>> 15, 0x735a2d97);
  return ((result ^ result >>> 15) >>> 0) / 4294967296;
};
const rgba = (rgb, alpha) => `rgba(${rgb},${clamp(alpha)})`;

function oval(ctx, x, y, rx, ry, fill, stroke = null, rotation = 0) {
  if (rx <= 0 || ry <= 0) return;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rotation, 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

function line(ctx, points, color, width = 1) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index++) ctx.lineTo(points[index][0], points[index][1]);
  ctx.stroke();
}

function heart(ctx, x, y, size, color = '#e9a0b8') {
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y + size * .6);
  ctx.bezierCurveTo(x - size * 1.7, y - size * .3, x - size * .85, y - size * 1.5, x, y - size * .6);
  ctx.bezierCurveTo(x + size * .85, y - size * 1.5, x + size * 1.7, y - size * .3, x, y + size * .6); ctx.fill();
}

function star(ctx, x, y, size, color = '#d5e9ed') {
  ctx.strokeStyle = color; ctx.lineWidth = .75; ctx.beginPath();
  for (let index = 0; index < 3; index++) {
    const angle = index * Math.PI / 3, dx = Math.cos(angle) * size, dy = Math.sin(angle) * size;
    ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + dx, y + dy);
  }
  ctx.stroke();
}

function flame(ctx, x, y, height, phase) {
  const sway = Math.sin(phase) * height * .18;
  ctx.beginPath(); ctx.moveTo(x - height * .23, y);
  ctx.bezierCurveTo(x - height * .6, y - height * .32, x + sway, y - height * .68, x + sway * .6, y - height);
  ctx.bezierCurveTo(x + height * .55, y - height * .48, x + height * .43, y - height * .28, x + height * .22, y); ctx.closePath();
  const gradient = ctx.createLinearGradient(x, y, x, y - height);
  gradient.addColorStop(0, '#fce2a0'); gradient.addColorStop(.32, '#ed9450'); gradient.addColorStop(1, '#bd4b3c');
  ctx.fillStyle = gradient; ctx.fill();
  oval(ctx, x, y - height * .22, height * .1, height * .27, '#fff1bf', null, -.1);
}

function coatGradient(ctx, x, y, radius, palette, charred, poison, death) {
  const gradient = ctx.createRadialGradient(x - radius * .3, y - radius * .5, 1, x, y, radius);
  gradient.addColorStop(0, charred > .8 ? '#70615d' : poison > .6 ? '#c0c3a2' : palette.light);
  gradient.addColorStop(.48, charred > .8 ? '#403b3e' : death > .7 ? '#aaa9b2' : palette.base);
  gradient.addColorStop(1, charred > .8 ? '#25262c' : palette.dark);
  return gradient;
}

function irregularPatch(ctx, x, y, rx, ry, seed, index, color, edge = null) {
  ctx.beginPath();
  for (let part = 0; part < 12; part++) {
    const angle = part / 12 * TAU, ragged = .76 + randomAt(seed, index * 23 + part) * .33;
    const px = x + Math.cos(angle) * rx * ragged, py = y + Math.sin(angle) * ry * ragged;
    if (!part) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = .75; ctx.stroke(); }
}

function coatPalette(seed) {
  return [
    { base: '#d8c4a3', light: '#f3e6c9', dark: '#8c7b69', belly: '#ebdcc0' },
    { base: '#b5aaa0', light: '#ded7c7', dark: '#73696a', belly: '#d9d1be' },
    { base: '#b99175', light: '#dcbca0', dark: '#70564f', belly: '#dbc2a6' },
    { base: '#d3d2c4', light: '#f0eddc', dark: '#8e8d8d', belly: '#e4e1d0' }
  ][seed % 4];
}

const exposure = (rabbit, channel) => Math.max(0, Number(rabbit.exposure?.[channel]) || 0);

/** Draw a single rabbit on a floor, in a 100-unit anatomical coordinate space.
 * `now` is injectable so a recorded trial can replay its brief flames. */
export function drawRabbit(ctx, rabbit, x, floor, size, time = 0, options = {}) {
  if (!ctx || !rabbit) return;
  const seed = Number(rabbit.mutation?.seed) || hash(rabbit.id || rabbit.name || 'rabbit');
  const rand = index => randomAt(seed, index);
  const alive = rabbit.stats?.alive !== false;
  const baby = rabbit.age === 'baby' || rabbit.age === 'juvenile';
  const now = options.now ?? Date.now();
  const matureAt = Number(rabbit.maturesAt ?? rabbit.adultAt ?? rabbit.growAt);
  const growthByTime = matureAt > Number(rabbit.bornAt) ? (now - Number(rabbit.bornAt)) / (matureAt - Number(rabbit.bornAt)) : 0;
  const growth = clamp(rabbit.ageProgress ?? rabbit.growthProgress ?? (Number.isFinite(rabbit.stats?.growth) ? rabbit.stats.growth / 100 : growthByTime));
  const babyScale = baby ? lerp(.61, .88, growth) : 1;
  const strengthLoad = exposure(rabbit, 'strength'), strength = clamp(strengthLoad / 3);
  const acidLoad = exposure(rabbit, 'acidity'), acid = clamp(acidLoad / 2.5);
  const fireLoad = exposure(rabbit, 'fire'), scorch = rabbit.deathAppearance === 'charred' ? 1 : clamp(fireLoad / 2.5);
  const morphLoad = exposure(rabbit, 'transformation'), morph = clamp(morphLoad / 3);
  const loveLoad = exposure(rabbit, 'love'), love = clamp(loveLoad / 2.5);
  const frost = clamp(exposure(rabbit, 'freeze') / 4);
  const poison = clamp(exposure(rabbit, 'poison') / 1.25);
  const death = clamp(exposure(rabbit, 'death') / 1.25);
  const angry = rabbit.aggression === true || loveLoad >= 2.5;
  const dangerous = rabbit.dangerous || morphLoad >= 3 && rabbit.mutation?.outcome === 'creature';
  const health = clamp((rabbit.stats?.health ?? 100) / 100);
  const burning = scorch > 0 && Number(rabbit.activeFireUntil) > now;
  const facing = options.facing === -1 ? -1 : 1;
  const palette = coatPalette(seed);
  const dissolved = !alive && (rabbit.deathAppearance === 'dissolved' || acidLoad >= 2.5);
  const breath = alive ? Math.sin(time * .004 + rand(1) * TAU) * .8 * (1 - frost) : 0;
  const shiver = alive ? Math.sin(time * .043 + seed) * frost * .8 : 0;
  const scale = size / 100 * babyScale;

  ctx.save(); ctx.translate(x, floor); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // Rings sit under the animal so the selected specimen stays identifiable.
  if (options.selected) {
    oval(ctx, 0, 1, Math.max(19, size * babyScale * .55), 8, rgba(options.cullMode ? '230,129,121' : '231,196,132', .12), options.cullMode ? '#df8079' : '#e7c484');
  }
  oval(ctx, -2, 1, size * babyScale * (.43 + strength * .2), 4 + size * .025, rgba('17,23,29', .38));
  ctx.scale(scale * facing, scale);

  if (acid > .06) {
    const spread = 12 + acid * 39;
    oval(ctx, -8, 2, spread, 3 + acid * 4, '#626b4a');
    oval(ctx, -13, 1, spread * .8, 2 + acid * 2, '#99a16e');
    for (let index = 0; index < 5; index++) {
      const bx = -39 + rand(400 + index) * 64, by = 1 - (time * .012 + index * 11) % (5 + acid * 15);
      if (acid > .45) oval(ctx, bx, by, 1 + acid * 1.5, 1 + acid * 1.5, rgba('177,194,120', .45));
    }
  }
  if (dissolved) {
    irregularPatch(ctx, -12, 0, 29, 3.8, seed, 47, '#8e7460');
    for (let index = 0; index < 6; index++) line(ctx, [[-31 + index * 8, -1], [-32 + index * 8, -4 - rand(index) * 3]], '#d0b79e', .8);
    ctx.restore(); return;
  }

  // Advanced corrosion loses volume as well as fur; burns remain after flames.
  const erosion = acid > .5 ? 1 - (acid - .5) * 1.15 : 1;
  ctx.translate(shiver + Math.sin(time * .002 + seed) * poison, alive ? -breath : 0);
  if (!alive) ctx.scale(1, .58);
  ctx.scale(erosion, erosion);
  const muscle = strength * (baby ? .8 : 1);
  const rearRadius = 18 + muscle * 22, shoulderRadius = 12 + muscle * 23;
  const bodyLength = 30 + muscle * 10 + morph * (rand(8) * 17 - 4);
  const bodyHeight = (baby ? 24 : 21) + muscle * 11;
  const backY = -31 - muscle * 6 - morph * rand(10) * 8;
  const headX = 28 + morph * (rand(12) * 18 - 6);
  const headY = -52 - muscle * 7 + poison * 12 + (alive ? 0 : 15);
  const earLength = (baby ? 19 : 27) + morph * (rand(15) * 39 - 19);
  const ear2Length = (baby ? 18 : 25) + morph * (rand(16) * 39 - 18);
  const earTilt = (alive ? -.17 : -.9) + poison * .6 + morph * (rand(17) - .5) * .8;
  const outline = scorch > .8 ? '#26242b' : '#635951';
  const fur = (cx, cy, radius) => coatGradient(ctx, cx, cy, radius, palette, scorch, poison, death);
  ctx.globalAlpha = 1 - death * .25;
  ctx.lineWidth = 1.1;

  // Far legs and ear are darker, giving the body a readable, layered profile.
  oval(ctx, -15, -11, 12 + muscle * 10, 13 + morph * rand(22) * 11, palette.dark, outline, -.35);
  oval(ctx, 19, -13, 5 + muscle * 8, 16 + morph * rand(23) * 13, palette.dark, outline, -.15);
  oval(ctx, -7, -3, 18 + muscle * 7, 4.3, palette.dark, outline);
  oval(ctx, 32, -3, 10, 4, palette.dark, outline);
  oval(ctx, headX + 7, headY - 21 - ear2Length * .35, 5.8 + morph * rand(24) * 3, ear2Length, palette.dark, outline, earTilt + .2);

  // Transformation grows coherent anatomical features on this rabbit's seed.
  if (morph > .28) {
    const emergence = clamp((morph - .28) / .72);
    const spineCount = 3 + Math.floor(rand(33) * 4);
    for (let index = 0; index < spineCount; index++) {
      const sx = -31 + index * 48 / spineCount, sy = backY - bodyHeight * .8;
      const height = (7 + rand(34 + index) * 24) * emergence;
      ctx.beginPath(); ctx.moveTo(sx - 5 * emergence, sy + 6);
      ctx.quadraticCurveTo(sx - 7, sy - height * .4, sx + (rand(44) - .5) * 12, sy - height);
      ctx.quadraticCurveTo(sx + 7, sy - height * .25, sx + 5 * emergence, sy + 5);
      ctx.fillStyle = dangerous ? '#a896be' : '#c5b1c5'; ctx.fill(); ctx.strokeStyle = '#62506f'; ctx.stroke();
    }
    if (rand(45) > .4) {
      const limbY = -12 - emergence * 6;
      line(ctx, [[0, -26], [-5 - emergence * 20, limbY], [-17 - emergence * 20, -4]], '#8e789b', 3 + emergence * 5);
      for (let claw = 0; claw < 3; claw++) line(ctx, [[-17 - emergence * 20, -4], [-22 - emergence * 20, -3 + claw * 2]], '#d7c1aa', 1);
    }
  }

  oval(ctx, -44 - muscle * 7, -27, baby ? 9 : 8.5, 9 + morph * rand(26) * 9, fur(-44, -28, 13), outline);
  oval(ctx, -9, backY, bodyLength, bodyHeight, fur(-9, backY, bodyLength + 6), outline, -.03);
  oval(ctx, -7, -20, 26 + muscle * 7, 11 + muscle * 7, scorch > .8 ? '#494044' : palette.belly, null, -.04);
  // Distinct hamstring, shoulder, pectoral and forearm volumes make even a small
  // cumulative strength dose noticeable without relying on an effect icon.
  oval(ctx, -24 - muscle * 3, -24 - muscle * 5, rearRadius, 21 + muscle * 16, fur(-25, -26, rearRadius * 1.4), outline, -.24);
  oval(ctx, 15 + muscle * 4, -31 - muscle * 5, shoulderRadius, 18 + muscle * 15, fur(15, -31, shoulderRadius * 1.4), outline, -.18);
  oval(ctx, 21 + muscle * 6, -22, 9 + muscle * 13, 15 + muscle * 12, fur(21, -22, 28), outline, .25);
  oval(ctx, 23 + muscle * 7, -13, 5 + muscle * 11, 14 + muscle * 5, fur(23, -13, 23), outline, -.13);
  oval(ctx, -22 - muscle * 4, -4, 21 + muscle * 9, 5.5 + muscle * 2, fur(-22, -5, 28), outline);
  oval(ctx, 31 + muscle * 7, -3, 13 + muscle * 5, 4.3 + muscle * 1.6, fur(31, -3, 19), outline);

  if (muscle > .02) {
    ctx.strokeStyle = rgba('106,82,75', .28 + muscle * .45); ctx.lineWidth = .7 + muscle * .65;
    for (const [cx, cy, rx, ry] of [[-24 - muscle * 3, -26, rearRadius * .72, 15 + muscle * 9], [14 + muscle * 4, -33, shoulderRadius * .68, 13 + muscle * 10], [24 + muscle * 7, -16, 3 + muscle * 6, 8 + muscle * 6]]) {
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, -.26, -.85, 1.5); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx - 2, cy - 2, rx * .68, ry * .85, -.26, 2.6, 4.8); ctx.stroke();
    }
    // At excessive mass, branching veins and a compressed neck remain visible.
    if (strengthLoad > 1.25) {
      const strain = clamp((strengthLoad - 1.25) / 1.75);
      line(ctx, [[-34, -37], [-28, -29], [-31, -22], [-27, -15]], rgba('104,89,111', .25 + strain * .65), 1 + strain);
      line(ctx, [[-28, -29], [-18, -34], [-14, -31]], rgba('104,89,111', .25 + strain * .65), .7 + strain * .6);
      line(ctx, [[16, -45 - muscle * 8], [23, -32], [21, -19], [27, -13]], rgba('104,89,111', .25 + strain * .65), .8 + strain * .8);
      if (strengthLoad > 2.3) line(ctx, [[headX - 7, headY + 5], [headX - 10, headY + 10], [headX - 7, headY + 14]], '#b87d76', 1.5);
    }
  }

  // Small fur strokes follow body and muscle contours. Their placement is fixed.
  for (let index = 0; index < 45; index++) {
    const angle = rand(60 + index) * TAU, radius = Math.sqrt(rand(120 + index)) * .9;
    const fx = -12 + Math.cos(angle) * (29 + muscle * 18) * radius;
    const fy = -30 + Math.sin(angle) * (18 + muscle * 15) * radius;
    line(ctx, [[fx - 1, fy], [fx + 1.2 + rand(190 + index) * 1.8, fy - 1.8]], rgba(scorch > .8 ? '123,111,107' : '247,231,204', .24 + rand(230 + index) * .25), .65);
  }

  // Fur loss and exposed tissue expand from the same patches across later doses.
  if (acid > 0) {
    ctx.save(); ctx.beginPath();
    ctx.ellipse(-10, -30, 32 + muscle * 17, 21 + muscle * 13, 0, 0, TAU);
    ctx.ellipse(16, -28, 14 + muscle * 22, 19 + muscle * 14, 0, 0, TAU); ctx.clip();
    const count = Math.ceil(acid * 11);
    for (let index = 0; index < count; index++) {
      const px = -36 + rand(300 + index) * 68, py = -46 + rand(320 + index) * 36;
      const radius = (.6 + acid * 11) * (.6 + rand(340 + index));
      irregularPatch(ctx, px, py, radius, radius * .75, seed, index, '#bd9784', '#806551');
      if (acid > .22) irregularPatch(ctx, px, py, radius * clamp((acid - .16) * 1.3), radius * .58 * clamp((acid - .16) * 1.3), seed, index, acid > .7 ? '#805959' : '#aa7770');
      if (acid > .58) line(ctx, [[px - radius * .25, py], [px + radius * .35, py + radius * .1]], '#d3a995', .8);
    }
    ctx.restore();
  }

  if (scorch > 0) {
    const count = Math.ceil(scorch * 9);
    for (let index = 0; index < count; index++) {
      const px = -37 + rand(450 + index) * 62, py = -42 + rand(470 + index) * 29;
      const radius = (1.8 + scorch * 9) * (.6 + rand(490 + index) * .6);
      irregularPatch(ctx, px, py, radius, radius * .55, seed, index + 22, scorch > .7 ? '#393338' : '#73584a');
      line(ctx, [[px - radius * .4, py], [px - radius * .2, py - radius * .5], [px + radius * .2, py - radius * .25]], scorch > .7 ? '#70605b' : '#4c3a36', .8);
    }
  }

  if (poison > 0) {
    for (let index = 0; index < Math.ceil(poison * 8); index++) {
      const px = -34 + rand(510 + index) * 60, py = -43 + rand(530 + index) * 33;
      irregularPatch(ctx, px, py, 2 + poison * 5, 2 + poison * 2, seed, index + 38, rgba('115,129,75', .18 + poison * .5));
    }
  }

  // Head and near ear are separated from the shoulder, with a clear muzzle.
  const headWidth = (baby ? 17.5 : 15) + morph * rand(550) * 12;
  oval(ctx, headX, headY, headWidth, (baby ? 17 : 15) + morph * rand(551) * 5, fur(headX, headY, 23), outline, -.1);
  oval(ctx, headX + 11, headY + 8, 9 + morph * rand(552) * 6, 7.5, scorch > .8 ? '#58504e' : palette.belly, outline);
  ctx.save(); ctx.translate(headX - 7, headY - 12); ctx.rotate(earTilt);
  oval(ctx, 0, -earLength * .68, 6.7 + morph * rand(553) * 3, earLength, fur(0, -earLength, earLength + 7), outline);
  oval(ctx, .9, -earLength * .72, 3.1 + morph * rand(554) * 2, earLength * .77, scorch > .75 ? '#625052' : poison > .6 ? '#a49d86' : '#ca9a9b');
  line(ctx, [[1, -earLength * .2], [1, -earLength * 1.35]], rgba('247,214,197', .5), .7); ctx.restore();

  if (morph > .1) {
    const tint = clamp((morph - .1) / .8);
    irregularPatch(ctx, headX - 4, headY - 1, 4 + tint * 8, 3 + tint * 6, seed, 63, rgba(rand(570) > .5 ? '136,157,170' : '163,137,173', tint * .5));
    if (morph > .32) {
      const horn = clamp((morph - .32) / .68), direction = rand(571) > .5 ? 1 : -1;
      ctx.fillStyle = '#c5b499'; ctx.strokeStyle = '#7a6774'; ctx.beginPath();
      ctx.moveTo(headX + 3, headY - 13); ctx.quadraticCurveTo(headX + 4 + direction * horn * 8, headY - 23 - horn * 12, headX + 11 + direction * horn * 16, headY - 17 - horn * 28);
      ctx.quadraticCurveTo(headX + 9 + horn * 5, headY - 22, headX + 10, headY - 11); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }

  const eyeX = headX + 6, eyeY = headY - 3;
  if (alive) {
    const blink = Math.sin(time * .0017 + rand(581) * 50) > .997;
    if (blink) line(ctx, [[eyeX - 3, eyeY], [eyeX + 3, eyeY]], '#39323b', 1.6);
    else {
      oval(ctx, eyeX, eyeY, (baby ? 3.4 : 2.5) + morph * rand(582) * 3.1, 3.4 + morph * rand(583) * 2, angry || dangerous ? '#c26560' : '#413741', '#a88d7f');
      oval(ctx, eyeX + .3, eyeY - .1, morph > .4 ? .8 : 1.35, 2.2, '#272734');
      oval(ctx, eyeX - .7, eyeY - 1.1, .85, 1, '#f5edda');
    }
    if (angry || dangerous) line(ctx, [[eyeX - 4, eyeY - 6], [eyeX + 4, eyeY - 3.3]], '#675052', 1.8);
    if (poison > .25) line(ctx, [[eyeX - 3, eyeY + 5], [eyeX + 3, eyeY + 5]], '#9e9678', 1.3);
  } else {
    line(ctx, [[eyeX - 3, eyeY - 3], [eyeX + 3, eyeY + 3]], '#51434c', 1.8);
    line(ctx, [[eyeX + 3, eyeY - 3], [eyeX - 3, eyeY + 3]], '#51434c', 1.8);
  }
  oval(ctx, headX + 20 + morph * rand(552) * 4, headY + 7, 2.7, 2.1, scorch > .75 ? '#816967' : '#bd8890');
  line(ctx, [[headX + 19, headY + 9], [headX + 17, headY + 12], [headX + 14, headY + 11]], '#8f7970', .8);
  for (let index = 0; index < 3; index++) {
    line(ctx, [[headX + 15, headY + 9], [headX + 26, headY + 6 + index * 3]], rgba('220,210,190', .8 - scorch * .5), .6);
  }
  // Toe divisions, nails and an exhausted posture support close inspection.
  for (let index = 0; index < 3; index++) {
    line(ctx, [[31 + muscle * 7 + index * 3, -6], [32 + muscle * 7 + index * 3, -1]], '#a38b76', .6);
  }
  if (dangerous) for (let index = 0; index < 3; index++) line(ctx, [[40 + muscle * 7, -3 + index], [47 + muscle * 7, -2 + index * 2]], '#dac8b1', 1.1);

  if (frost > 0) {
    ctx.fillStyle = rgba('158,211,222', frost * .19); ctx.strokeStyle = rgba('193,237,240', .25 + frost * .6); ctx.lineWidth = .8;
    for (let index = 0; index < Math.ceil(frost * 13); index++) {
      const px = -38 + rand(600 + index) * 82, py = -46 + rand(620 + index) * 43;
      const crystal = 2 + frost * (3 + rand(640 + index) * 5);
      ctx.beginPath(); ctx.moveTo(px - crystal * .4, py); ctx.lineTo(px, py - crystal * 1.7); ctx.lineTo(px + crystal * .6, py); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (index % 3 === 0) star(ctx, px, py - 2, 2 + frost * 3, '#ccebed');
    }
    if (frost > .65) {
      line(ctx, [[-43, -15], [-40, -48], [-15, -62], [16, -52], [44, -39], [49, -7]], rgba('197,235,244', (frost - .6) * 1.3), 2);
    }
  }
  ctx.globalAlpha = 1;

  if (burning) {
    const pulse = time * .012;
    for (let index = 0; index < 3 + Math.floor(scorch * 5); index++) {
      const px = -38 + rand(670 + index) * 76, py = -32 + rand(680 + index) * 18;
      flame(ctx, px, py, (6 + scorch * 34) * (.7 + Math.sin(pulse + index) * .2), pulse + index);
    }
    if (scorch > .4) for (let index = 0; index < 3; index++) {
      const rise = (time * .025 + index * 19) % 47;
      oval(ctx, -20 + index * 20 + Math.sin(rise * .1) * 5, -57 - rise, 5 + scorch * 6, 3 + scorch * 5, rgba('147,130,131', (1 - rise / 47) * .3));
    }
  }

  if (alive && love > .02 && !options.reference) {
    for (let index = 0; index < Math.ceil(love * 3); index++) {
      const rise = (time * (.013 + love * .016) + index * 22 + rand(700) * 70) % 49;
      ctx.globalAlpha = .45 + (1 - rise / 49) * .35;
      if (angry) {
        const hx = -14 + index * 18, hy = -67 - rise;
        line(ctx, [[hx - 5, hy - 4], [hx, hy], [hx - 5, hy + 4]], '#e39a83', 1.8);
        line(ctx, [[hx + 5, hy - 4], [hx, hy], [hx + 5, hy + 4]], '#e39a83', 1.8);
      } else heart(ctx, -17 + index * 20, -62 - rise, 2.8 + love * 3);
    }
    ctx.globalAlpha = 1;
  }
  if (death > .04) {
    const rise = (time * .015) % 30;
    for (let index = 0; index < 3; index++) {
      const sx = -25 + index * 20;
      ctx.strokeStyle = rgba('178,171,211', death * .5); ctx.lineWidth = 1.8; ctx.beginPath();
      ctx.moveTo(sx, -43); ctx.bezierCurveTo(sx - 6, -60, sx + 7, -76, sx, -83 - rise); ctx.stroke();
    }
  }
  if (health < .2 && alive) line(ctx, [[headX + 1, headY + 8], [headX + 8, headY + 9]], '#9c7d76', .8);
  ctx.restore();
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath(); ctx.moveTo(x + radius, y); ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius); ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height); ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius); ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y); ctx.closePath();
}

/** Shared pen and one isolation cage. Positions animate only the drawing;
 * breeding, aging and attacks remain controlled by the experiment simulation. */
export class RabbitColonyRenderer {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.targets = [];
    this.lastPaint = -Infinity; this.lastClock = 0; this.frozenClock = 0; this.paused = false;
  }

  render(experiments, selectedId, time = 0, cullMode = false, paused = false) {
    if (!this.ctx) return;
    const rabbits = experiments?.rabbits || [];
    if (paused && !this.paused) this.frozenClock = this.lastClock || time;
    const clock = paused ? this.frozenClock : time;
    this.paused = paused; this.lastClock = clock;
    const signature = `${selectedId}:${cullMode}:${paused}:${rabbits.map(rabbit => `${rabbit.id}:${rabbit.location}:${rabbit.age}:${rabbit.stats?.health}:${rabbit.stats?.doseCount}:${rabbit.stats?.alive}:${rabbit.dangerous}:${Object.values(rabbit.exposure || {}).join(',')}`).join('|')}`;
    if (signature === this.signature && (paused || time - this.lastPaint < 32)) return;
    this.signature = signature; this.lastPaint = time; this.targets = [];
    const ctx = this.ctx; ctx.save(); ctx.setTransform(this.canvas.width / 640, 0, 0, this.canvas.height / 350, 0, 0);
    ctx.clearRect(0, 0, 640, 350); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const wall = ctx.createLinearGradient(0, 0, 0, 350);
    wall.addColorStop(0, '#282b3c'); wall.addColorStop(.47, '#35394a'); wall.addColorStop(1, '#242e32');
    ctx.fillStyle = wall; ctx.fillRect(0, 0, 640, 350);
    for (let row = 0; row < 5; row++) for (let column = 0; column < 10; column++) {
      const bx = column * 76 + (row % 2 ? -38 : 0), by = row * 36;
      ctx.fillStyle = row % 2 ? '#383b4b' : '#323645'; ctx.fillRect(bx + 2, by + 2, 72, 32);
      line(ctx, [[bx + 3, by + 3], [bx + 73, by + 3]], '#444756', .6);
    }
    // Two pools of candlelight support fur and tissue contrast without glare.
    for (const [lx, ly] of [[65, 74], [568, 79]]) {
      const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, 145); glow.addColorStop(0, 'rgba(232,182,117,.1)'); glow.addColorStop(1, 'rgba(232,182,117,0)');
      ctx.fillStyle = glow; ctx.fillRect(lx - 145, ly - 145, 290, 290);
      ctx.fillStyle = '#796451'; ctx.fillRect(lx - 7, ly - 12, 14, 4); ctx.fillStyle = '#ccb593'; ctx.fillRect(lx - 3, ly - 26, 6, 15);
      flame(ctx, lx, ly - 26, 9, clock * .006);
    }
    ctx.fillStyle = '#454d42'; roundedRect(ctx, 18, 81, 398, 225, 15); ctx.fill();
    ctx.fillStyle = '#59624c'; roundedRect(ctx, 24, 87, 386, 212, 12); ctx.fill();
    for (let index = 0; index < 75; index++) {
      const gx = 31 + randomAt(831, index) * 370, gy = 97 + randomAt(155, index) * 188;
      line(ctx, [[gx - 2, gy + 1], [gx, gy - 2], [gx + 3, gy]], index % 3 ? '#717b58' : '#87906a', .75);
    }
    // Straw and feeding details give the enclosure a legible physical scale.
    oval(ctx, 67, 121, 25, 7, '#3c493a'); oval(ctx, 65, 118, 20, 5, '#a69b69');
    for (let index = 0; index < 12; index++) line(ctx, [[49 + index * 2.5, 116 + index % 3], [58 + index * 2, 121]], '#d1b680', .7);
    oval(ctx, 382, 116, 16, 7, '#9b8a74', '#333c3b'); oval(ctx, 382, 114, 13, 4, '#7ba5ad');
    this.fence(ctx, false);

    ctx.font = '600 13px Georgia, serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#dfcaa7'; ctx.fillText('Rabbit colony', 24, 33);
    ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = '#aeb2a1';
    const living = rabbits.filter(rabbit => rabbit.stats?.alive !== false);
    ctx.fillText(`${living.length} living · ${living.filter(rabbit => rabbit.age === 'baby').length} babies`, 24, 49);
    ctx.fillStyle = '#dfcaa7'; ctx.font = '600 13px Georgia, serif'; ctx.fillText('Isolation cage', 444, 33);
    ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = '#aeb2a1'; ctx.fillText(cullMode ? 'Cull tool equipped' : 'Select a rabbit to inspect', 444, 49);

    const pen = rabbits.filter(rabbit => rabbit.location !== 'cage');
    const rows = Math.max(3, Math.ceil(pen.length / 4));
    const rowSpacing = 119 / Math.max(1, rows - 1);
    const colonySize = Math.min(59, rowSpacing * 1.18);
    const positioned = pen.map((rabbit, index) => {
      const seed = hash(rabbit.id), adult = rabbit.age !== 'baby', alive = rabbit.stats?.alive !== false;
      const column = index % 4, row = Math.floor(index / 4);
      const walk = alive && !rabbit.dangerous ? 1 : .25;
      return { rabbit, seed, x: 69 + column * 91 + Math.sin(clock * .0005 + seed % 13) * 11 * walk,
        y: 159 + row * rowSpacing + Math.cos(clock * .00037 + seed % 17) * Math.min(6, rowSpacing * .09) * walk,
        size: adult ? colonySize : colonySize + 1 };
    }).sort((a, b) => a.y - b.y);

    // Courtship relates two actual adult rabbits; no imaginary companion appears.
    const affectionate = positioned.filter(item => item.rabbit.stats?.alive !== false && item.rabbit.age !== 'baby' && exposure(item.rabbit, 'love') > .05 && !item.rabbit.aggression && !item.rabbit.dangerous && exposure(item.rabbit, 'love') < 2.5);
    for (const admirer of affectionate) {
      const partner = positioned.find(item => item.rabbit.stats?.alive !== false && item.rabbit.age !== 'baby' && item.rabbit.id !== admirer.rabbit.id && item.rabbit.sex !== admirer.rabbit.sex && !item.rabbit.dangerous && !item.rabbit.aggression);
      if (partner) {
        ctx.setLineDash([2, 5]); line(ctx, [[admirer.x, admirer.y - 31], [partner.x, partner.y - 31]], 'rgba(206,145,163,.27)', .8); ctx.setLineDash([]);
        heart(ctx, lerp(admirer.x, partner.x, .5), lerp(admirer.y, partner.y, .5) - 34 - Math.sin(clock * .003) * 3, 3.3, '#d6a1af');
      }
    }
    for (const item of positioned) this.specimen(ctx, item.rabbit, item.x, item.y, item.size, clock, selectedId, cullMode, item.seed);
    this.fence(ctx, true);
    this.cage(ctx);
    const isolated = rabbits.find(rabbit => rabbit.location === 'cage');
    if (isolated) this.specimen(ctx, isolated, 532, 270, 111, clock, selectedId, cullMode, hash(isolated.id), true);
    else {
      ctx.textAlign = 'center'; ctx.font = '11px Georgia, serif'; ctx.fillStyle = '#9d9b90'; ctx.fillText('An empty observation cage', 529, 213);
    }
    // Front cage bars frame the specimen without hiding the inspected anatomy.
    line(ctx, [[438, 298], [620, 298]], '#9f9683', 2.2); line(ctx, [[438, 304], [620, 304]], '#514c46', 4);
    ctx.fillStyle = '#aaa995'; ctx.textAlign = 'left'; ctx.font = '10px system-ui, sans-serif';
    ctx.fillText(cullMode ? 'Click a rabbit to cull it immediately' : 'Click a rabbit in the pen or cage to select it', 24, 330);
    ctx.restore();
  }

  specimen(ctx, rabbit, x, y, size, time, selectedId, cullMode, seed, isolated = false) {
    const selected = rabbit.id === selectedId, alive = rabbit.stats?.alive !== false;
    const facing = isolated ? 1 : Math.sin(time * .0005 + seed % 13 + Math.PI / 2) < -.3 ? -1 : 1;
    drawRabbit(ctx, rabbit, x, y, size, time, { facing, selected, cullMode });
    const baby = rabbit.age === 'baby', labelY = y + 15;
    const name = String(rabbit.name || 'Moon rabbit');
    const label = `${name.length > 12 ? `${name.slice(0, 11)}…` : name} ${rabbit.sex === 'male' ? '♂' : rabbit.sex === 'female' ? '♀' : ''}`;
    ctx.font = `${selected ? '600 ' : ''}${isolated ? 11 : 9}px system-ui, sans-serif`;
    const labelWidth = Math.min(isolated ? 164 : 87, ctx.measureText(label).width + 10);
    ctx.fillStyle = selected ? '#494535' : '#333c35'; roundedRect(ctx, x - labelWidth / 2, labelY - 9, labelWidth, 14, 4); ctx.fill();
    ctx.textAlign = 'center'; ctx.fillStyle = selected ? '#ead5a9' : alive ? '#d7d1ba' : '#a9a299'; ctx.fillText(label, x, labelY + 1);
    if (baby || !alive || rabbit.dangerous || rabbit.aggression) {
      ctx.font = '8px system-ui, sans-serif'; ctx.fillStyle = !alive ? '#baaaa1' : rabbit.dangerous || rabbit.aggression ? '#e29b88' : '#b8c7a7';
      ctx.fillText(!alive ? rabbit.deathAppearance === 'dissolved' || exposure(rabbit, 'acidity') >= 2.5 ? 'dissolved' : 'deceased' : rabbit.dangerous || rabbit.aggression ? 'dangerous' : 'baby · fragile', x, labelY + 13);
    }
    const drawSize = size * (baby ? .7 : 1);
    this.targets.push({ id: rabbit.id, x, y: y - drawSize * .46, width: Math.max(34, drawSize * 1.2), height: Math.max(40, drawSize * 1.13), floor: y });
  }

  fence(ctx, foreground) {
    if (!foreground) {
      line(ctx, [[23, 105], [413, 105]], '#a28c69', 4); line(ctx, [[23, 122], [413, 122]], '#75674f', 3);
      for (const x of [23, 119, 216, 313, 413]) {
        ctx.fillStyle = '#807053'; ctx.fillRect(x - 3, 88, 7, 55); ctx.fillStyle = '#b29a72'; ctx.fillRect(x - 2, 88, 2, 55);
      }
      line(ctx, [[22, 111], [22, 284]], '#817251', 3); line(ctx, [[414, 112], [414, 285]], '#817251', 3);
      return;
    }
    for (const x of [23, 119, 216, 313, 413]) {
      ctx.fillStyle = '#6b604c'; ctx.fillRect(x - 4, 276, 9, 38); ctx.fillStyle = '#a38d6a'; ctx.fillRect(x - 3, 276, 3, 37);
      ctx.fillStyle = '#c3ad81'; ctx.fillRect(x - 4, 275, 9, 3);
    }
    line(ctx, [[22, 283], [413, 283]], '#a08d6a', 4); line(ctx, [[22, 300], [413, 300]], '#827253', 4);
    line(ctx, [[22, 282], [413, 282]], '#c1ac7f', 1);
    for (const x of [67, 160, 266, 357]) {
      line(ctx, [[x, 283], [x + 34, 300]], '#79694e', 2); line(ctx, [[x, 300], [x + 34, 283]], '#79694e', 2);
    }
  }

  cage(ctx) {
    ctx.fillStyle = '#333b3b'; roundedRect(ctx, 436, 130, 188, 176, 9); ctx.fill();
    const floor = ctx.createLinearGradient(436, 227, 436, 304); floor.addColorStop(0, '#777963'); floor.addColorStop(1, '#565b4b');
    ctx.fillStyle = floor; ctx.fillRect(440, 233, 180, 66);
    for (let index = 0; index < 14; index++) line(ctx, [[445 + index * 13, 239], [441 + index * 13, 298]], '#64674f', .7);
    ctx.fillStyle = '#454a47'; ctx.fillRect(444, 139, 172, 8);
    line(ctx, [[438, 137], [438, 302], [622, 302], [622, 137]], '#a39b86', 3);
    for (const x of [443, 470, 497, 524, 551, 578, 616]) {
      line(ctx, [[x, 149], [x, 234]], '#566061', 2); line(ctx, [[x + 1, 149], [x + 1, 234]], '#818984', .7);
    }
    line(ctx, [[438, 146], [622, 146]], '#b0a78e', 2.4); line(ctx, [[438, 134], [622, 134]], '#8b8b7c', 4);
    line(ctx, [[437, 134], [458, 115], [605, 115], [622, 134]], '#8f9389', 2);
    for (const x of [469, 497, 525, 553, 581]) line(ctx, [[x, 115], [x - 11, 133]], '#6c7471', 1);
    ctx.fillStyle = '#b69c6e'; ctx.fillRect(435, 189, 8, 13); ctx.fillStyle = '#3c4141'; ctx.fillRect(437, 194, 3, 6);
  }

  hitTest(clientX, clientY) {
    const bounds = this.canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    const x = (clientX - bounds.left) / bounds.width * 640, y = (clientY - bounds.top) / bounds.height * 350;
    // Keep small and crowded specimens tappable at phone canvas widths, then
    // resolve overlaps by proximity instead of whichever rabbit was drawn last.
    const minimumWidth = 28 * 640 / bounds.width, minimumHeight = 28 * 350 / bounds.height;
    let nearest = null, nearestDistance = Infinity;
    for (let index = this.targets.length - 1; index >= 0; index--) {
      const target = this.targets[index];
      if (Math.abs(x - target.x) > Math.max(target.width, minimumWidth) / 2 || Math.abs(y - target.y) > Math.max(target.height, minimumHeight) / 2) continue;
      const distance = ((x - target.x) * bounds.width / 640) ** 2 + ((y - target.y) * bounds.height / 350) ** 2;
      if (distance < nearestDistance) { nearest = target.id; nearestDistance = distance; }
    }
    return nearest;
  }
}
