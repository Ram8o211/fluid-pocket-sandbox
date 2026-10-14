import { experimentSubjectSprite } from './art.mjs';

const sprites = new Map(), ghosts = new Map();
const CHANNELS = ['strength', 'love', 'transformation', 'fire', 'freeze', 'poison', 'acidity', 'death', 'weakness'];
const bounded = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
// Make dilute responses legible, while preserving ordering and zero effects.
export const visualResponse = value => value <= .003 ? 0 : Math.pow(bounded(value), .48);

/** Actual exposure determines animation; posture retains the familiar's health.
 * No assay values or verbal observations are displayed by this visual model. */
export function trialVisuals(subject, report, before = false) {
  const stats = before && report ? report.before : subject.stats;
  const effects = !before && report ? report.effects : {};
  const baseStrength = subject.id === 'beetle' ? 35 : 20;
  return {
    strength: visualResponse(Math.max(effects.strength || 0, (stats.strength - baseStrength) / 65)),
    love: visualResponse(Math.max(effects.love || 0, stats.love / 100)),
    transformation: visualResponse(Math.max(effects.transformation || 0, stats.transformation / 100)),
    fire: visualResponse(Math.max(effects.fire || 0, stats.burning / 100)),
    freeze: visualResponse(Math.max(effects.freeze || 0, stats.freezing / 100)),
    poison: visualResponse(effects.poison || 0), acidity: visualResponse(effects.acidity || 0),
    death: visualResponse(effects.death || 0), weakness: visualResponse(1 - stats.health / 100), alive: stats.alive
  };
}

function ellipse(ctx, x, y, rx, ry, color) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
}
function heart(ctx, x, y, size) {
  ctx.beginPath(); ctx.moveTo(x, y + size);
  ctx.bezierCurveTo(x - size * 1.6, y, x - size, y - size, x, y - size * .35);
  ctx.bezierCurveTo(x + size, y - size, x + size * 1.6, y, x, y + size); ctx.fill();
}
function flame(ctx, x, y, size) {
  ctx.fillStyle = '#ff7a37'; ctx.beginPath(); ctx.moveTo(x - size * .55, y);
  ctx.quadraticCurveTo(x - size, y - size, x + size * .15, y - size * 2.5);
  ctx.quadraticCurveTo(x - size * .1, y - size * 1.1, x + size * .7, y - size * .7);
  ctx.quadraticCurveTo(x + size, y, x - size * .55, y); ctx.fill();
  ellipse(ctx, x, y - size * .55, size * .3, size * .65, '#ffe58a');
}
function snowflake(ctx, x, y, size) {
  ctx.beginPath();
  for (let k = 0; k < 3; k++) { const a = k * Math.PI / 3, dx = Math.cos(a) * size, dy = Math.sin(a) * size; ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + dx, y + dy); }
  ctx.stroke();
}

/** A bounded 30fps stage with a permanent untreated reference. Replaying or
 * pausing changes only the picture, never doses, statistics or trial records. */
export class TestingRenderer {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.report = null; this.subject = null;
    this.startedAt = null; this.lastTime = 0; this.lastPaint = 0; this.paused = false; this.dirty = true;
    this.frameVisual = { alive: true }; this.pendingSprites = new Set();
    this.background = document.createElement('canvas'); this.background.width = 384; this.background.height = 248;
    const ctx = this.background.getContext('2d');
    ctx.fillStyle = '#222435'; ctx.fillRect(0, 0, 384, 248);
    ctx.fillStyle = '#34394b';
    for (let y = 0; y < 210; y += 34) for (let x = (y % 68 ? -20 : 0); x < 384; x += 48) ctx.fillRect(x + 2, y + 2, 44, 29);
    ctx.fillStyle = '#596752'; ctx.fillRect(0, 211, 384, 37); ctx.fillStyle = '#9da779'; ctx.fillRect(0, 210, 384, 3);
    ctx.fillStyle = '#191f2b'; ctx.fillRect(81, 0, 4, 248);
    ctx.fillStyle = '#8e8a76'; ctx.fillRect(81, 0, 2, 248);
    ctx.fillStyle = '#e0ba7b'; ctx.fillRect(7, 6, 67, 3); ctx.fillStyle = '#a5d9ba'; ctx.fillRect(94, 6, 280, 3);
    ellipse(ctx, 44, 215, 30, 5, '#333f3f'); ellipse(ctx, 235, 217, 76, 8, '#333f3f');
  }
  sprite(id, state = 'healthy') {
    const key = `${id}:${state}`;
    if (!sprites.has(key)) { const image = new Image(); image.src = experimentSubjectSprite(id, state); sprites.set(key, image); }
    const image = sprites.get(key);
    if (!image.complete && !this.pendingSprites.has(key)) {
      this.pendingSprites.add(key);
      image.addEventListener('load', () => { this.pendingSprites.delete(key); this.dirty = true; }, { once: true });
    }
    return image;
  }
  ghost(id) {
    if (!ghosts.has(id)) {
      const sprite = this.sprite(id); if (!sprite.complete || !sprite.naturalWidth) return null;
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 56;
      const ctx = canvas.getContext('2d'); ctx.drawImage(sprite, 0, 0); ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = '#d2e5ff'; ctx.fillRect(0, 0, 64, 56); ghosts.set(id, canvas);
    }
    return ghosts.get(id);
  }
  replay() { this.startedAt = null; this.paused = false; this.resume = false; this.dirty = true; }
  togglePause() {
    this.paused = !this.paused;
    if (this.paused) this.frozenAt = this.lastTime; else this.resume = true;
    this.dirty = true; return this.paused;
  }
  render(subject, report, time, before = false) {
    if (!this.ctx || !subject) return;
    if (this.subject !== subject || this.report !== report) {
      this.subject = subject; this.report = report;
      this.untreated = trialVisuals(subject, report, true); this.treated = trialVisuals(subject, report);
      this.replay();
    }
    if (this.before !== before) { this.before = before; this.dirty = true; }
    if (!this.dirty && (this.paused || time - this.lastPaint < 32)) return;
    if (this.startedAt === null) this.startedAt = time;
    if (this.resume) { this.startedAt += time - this.frozenAt; this.resume = false; }
    const clock = this.paused ? this.frozenAt : time;
    this.lastTime = clock; this.lastPaint = time; this.dirty = false;
    const elapsed = Math.max(0, clock - this.startedAt), applied = before || !report ? 0 : Math.min(1, Math.max(0, (elapsed - 260) / 900));
    for (const key of CHANNELS) this.frameVisual[key] = this.untreated[key] + (this.treated[key] - this.untreated[key]) * applied;
    this.frameVisual.alive = applied < .75 ? this.untreated.alive : this.treated.alive;
    const ctx = this.ctx; ctx.save(); ctx.scale(this.canvas.width / 384, this.canvas.height / 248);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(this.background, 0, 0);
    this.drawCreature(subject.id, this.untreated, 43, 186, 68, elapsed, 1, true);
    this.drawPlants(65, 211, .38, 0, elapsed);
    this.drawScene(subject.id, before ? this.untreated : this.frameVisual, elapsed, 1);
    if (report && !before && elapsed < 1160) this.drawDose(elapsed);
    ctx.restore();
  }
  drawDose(time) {
    const ctx = this.ctx, progress = Math.min(1, time / 700);
    ctx.save(); ctx.globalAlpha = 1 - Math.max(0, (time - 700) / 460);
    ctx.translate(250, 65); ctx.rotate(-.6);
    ctx.fillStyle = '#bedde7'; ctx.fillRect(-8, -18, 16, 28); ctx.fillStyle = this.report.sample.color || '#a49bdc'; ctx.fillRect(-6, -4, 12, 12); ctx.fillStyle = '#ad7e56'; ctx.fillRect(-7, -22, 14, 7);
    ctx.restore();
    if (progress < 1) ellipse(ctx, 258, 87 + progress * 68, 4, 7, this.report.sample.color || '#a49bdc');
  }
  drawPlants(x, floor, scale, withering, time) {
    const ctx = this.ctx; ctx.save(); ctx.translate(x, floor); ctx.scale(scale, scale);
    for (let i = 0; i < 3; i++) {
      const lean = withering * (12 + i * 6), top = -38 + withering * 20 - i * 7;
      ctx.strokeStyle = withering > .15 ? '#96835c' : '#82c680'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(i * 8 - 8, 0); ctx.quadraticCurveTo(i * 8 - 8, -30, i * 8 - 8 + lean, top); ctx.stroke();
      ellipse(ctx, i * 8 - 15 + lean * .3, top * .5, 8 * (1 - withering * .5), 3, withering > .15 ? '#a89060' : '#91d68d');
      ellipse(ctx, i * 8 - 8 + lean, top, 6 * (1 - withering * .45), 6 * (1 - withering * .6), withering > .15 ? '#ab897c' : '#edb6cc');
      if (withering) { const drop = (time * .018 + i * 16) % 40; ellipse(ctx, i * 8 + lean + Math.sin(drop * .14) * 6, -38 + drop, 4, 2, '#bd9c65'); }
    }
    ctx.restore();
  }
  drawCreature(id, visual, x, y, size, time, amount, reference = false) {
    const ctx = this.ctx, strength = visual.strength * amount, change = visual.transformation * amount;
    const frost = visual.freeze * amount, venom = visual.poison * amount, death = visual.death * amount;
    const alive = amount < .8 || visual.alive, speed = Math.max(.08, 1 - frost * .9 - venom * .3);
    const bounce = alive ? Math.abs(Math.sin(time * .003 * speed)) * (reference ? 2 : 5) * (1 - venom * .8) : 0;
    const tilt = alive ? Math.sin(time * .003) * venom * .28 - strength * .12 : -1.35;
    const state = !alive ? 'dead' : venom > .06 ? 'poisoned' : change > .05 ? 'transformed' : frost > .1 ? 'frozen' : 'healthy';
    const sprite = this.sprite(id, state), displaySize = size * (1 + strength * .18 + change * .15);
    ctx.save(); ctx.translate(x + Math.sin(time * .004) * venom * 8, y - bounce + visual.weakness * amount * 9); ctx.rotate(tilt);
    if (change > 0) {
      ctx.fillStyle = '#b695f4'; ctx.strokeStyle = '#efccff'; ctx.lineWidth = 2;
      for (const side of [-1, 1]) {
        const spread = (displaySize * .45 + 22 + Math.sin(time * .005) * 6) * change;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(side * 25 * change, -52 * change, side * spread, -15 - change * 60, side * spread * .85, 6);
        ctx.quadraticCurveTo(side * 20 * change, -10, 0, 6); ctx.fill(); ctx.stroke();
      }
    }
    ctx.globalAlpha = Math.max(.35, 1 - death * .55);
    if (sprite.complete && sprite.naturalWidth) ctx.drawImage(sprite, -displaySize / 2, -displaySize * .62, displaySize, displaySize * .875);
    ctx.globalAlpha = 1;
    if (id === 'stone' || id === 'seedling') { ellipse(ctx, -7, -15, 4, 5, '#ffeec2'); ellipse(ctx, 10, -15, 4, 5, '#ffeec2'); ellipse(ctx, -6, -14, 2, 3, '#25273a'); ellipse(ctx, 11, -14, 2, 3, '#25273a'); }
    if (venom) {
      ctx.globalAlpha = .65 + venom * .3;
      ellipse(ctx, displaySize * .18, -displaySize * .2, 9 + venom * 6, 4 + venom * 3, '#aad573');
      ctx.strokeStyle = '#d3ef8a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(displaySize * .26, -displaySize * .16); ctx.lineTo(displaySize * .3, -displaySize * .05); ctx.stroke();
    }
    ctx.restore();
  }
  drawScene(id, visual, time, amount) {
    const ctx = this.ctx, strength = visual.strength * amount, love = visual.love * amount, change = visual.transformation * amount;
    const fire = visual.fire * amount, frost = visual.freeze * amount, venom = visual.poison * amount, death = visual.death * amount, blight = visual.acidity * amount;
    const x = 226 + love * 22, y = 181 - strength * 8;
    this.drawPlants(120, 211, .85, blight, time); this.drawPlants(360, 211, .85, blight, time);
    const companion = this.sprite(id);
    const companionX = 334 - love * 38;
    if (companion.complete && companion.naturalWidth) ctx.drawImage(companion, companionX - 32, 156, 64, 56);
    // Fixed stone weights provide a reference as the creature lifts them.
    const lift = visual.alive ? strength * (70 + Math.sin(time * .003) * 8) : 0;
    const weightY = 195 - lift;
    if (fire) {
      ctx.globalAlpha = .6 + fire * .4;
      for (let i = 0; i < 8; i++) flame(ctx, x - 46 + i * 13, 211, (6 + fire * 17) * (.8 + Math.sin(time * .008 + i) * .2));
      ctx.globalAlpha = 1;
    }
    if (venom) ellipse(ctx, x + 30, 215, 8 + venom * 23, 3 + venom * 3, '#7ab15b');
    this.drawCreature(id, visual, x, y, 132, time, amount);
    // Foreground weights must stay visible against the creature's torso.
    ctx.fillStyle = '#d2cfdf'; ctx.fillRect(x - 24, weightY, 51, 5);
    ctx.fillStyle = '#494655'; ctx.fillRect(x - 42, weightY - 14, 21, 33); ctx.fillRect(x + 24, weightY - 14, 21, 33);
    ctx.fillStyle = '#8d839f'; ctx.fillRect(x - 40, weightY - 12, 17, 29); ctx.fillRect(x + 26, weightY - 12, 17, 29);
    ctx.fillStyle = '#d6cde6'; ctx.fillRect(x - 39, weightY - 11, 5, 25); ctx.fillRect(x + 27, weightY - 11, 5, 25);
    if (strength && visual.alive) {
      ctx.strokeStyle = '#ffe399'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x - 17, y - 6); ctx.lineTo(x - 18, weightY + 2); ctx.moveTo(x + 19, y - 6); ctx.lineTo(x + 20, weightY + 2); ctx.stroke();
      ctx.strokeStyle = '#ead7a1'; ctx.lineWidth = 2;
      for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + side * 44, weightY); ctx.lineTo(x + side * 51, weightY - 8); ctx.stroke(); }
    }
    if (frost) {
      const extent = 36 + frost * 20;
      ctx.fillStyle = `rgba(102,210,247,${.12 + frost * .3})`; ctx.strokeStyle = '#b4f2ff'; ctx.lineWidth = 2 + frost;
      ctx.beginPath(); ctx.moveTo(x - extent, 210); ctx.lineTo(x - extent - 7, y - 34); ctx.lineTo(x - 15, y - 86); ctx.lineTo(x + extent, y - 62); ctx.lineTo(x + extent + 8, 204); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#defaff'; ctx.lineWidth = 1.8;
      for (let i = 0; i < 6; i++) snowflake(ctx, x - 42 + i * 17, y - 45 + Math.sin(i + time * .0007) * 28, 4 + frost * 5);
      ellipse(ctx, x, 215, 48 + frost * 13, 4, '#b4e9f6');
    }
    if (fire) {
      ctx.globalAlpha = .7 + fire * .3;
      for (let i = 0; i < 4; i++) flame(ctx, x + 42 + i * 11, y - 21 + i * 4, (4 + fire * 10) * (1 - i * .13));
      ctx.globalAlpha = 1;
    }
    if (fire && frost) {
      ctx.globalAlpha = Math.min(fire, frost) * .7;
      for (let i = 0; i < 4; i++) ellipse(ctx, x + 40 + Math.sin(i) * 16, y - 25 - (time * .025 + i * 13) % 65, 12, 7, '#f2f1e8');
      ctx.globalAlpha = 1;
    }
    if (venom) {
      ctx.globalAlpha = .7 + venom * .3;
      for (let i = 0; i < 5; i++) { const rise = (time * .018 + i * 14) % 75; ellipse(ctx, x - 35 + i * 17, y + 22 - rise, 3 + venom * 5, 4 + venom * 4, '#a7df68'); }
      ctx.globalAlpha = 1;
    }
    if (love) {
      ctx.fillStyle = '#ff93c5'; ctx.globalAlpha = .65 + love * .35;
      for (let i = 0; i < 4; i++) heart(ctx, x + 25 + i * 13, y - 30 - (time * .022 + i * 17) % 62, 4 + love * 7);
      ctx.globalAlpha = 1;
    }
    if (change) {
      ctx.strokeStyle = '#dcbdff'; ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) { const angle = i * 2.39996 + time * .0009; snowflake(ctx, x + Math.cos(angle) * 69, y - 27 + Math.sin(angle) * 58, 3 + change * 4); }
    }
    if (death) {
      const soul = this.ghost(id), rise = 18 + death * 24 + (time * .01) % 24;
      ctx.globalAlpha = .35 + death * .45;
      if (soul) ctx.drawImage(soul, x - 48 + Math.sin(time * .002) * 6, y - 71 - rise, 96, 84);
      ctx.strokeStyle = '#c8bbef'; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x - 25 + i * 22, y - 22); ctx.quadraticCurveTo(x - 43 + i * 25, y - 45, x - 24 + i * 22, y - 66 - rise); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
  }
}
