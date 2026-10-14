import { drawPixelRabbit as drawRabbit } from './RabbitPixelArt.mjs';
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

const exposure = (rabbit, channel) => Math.max(0, Number(rabbit.exposure?.[channel]) || 0);

export { drawPixelRabbit as drawRabbit } from './RabbitPixelArt.mjs';

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
