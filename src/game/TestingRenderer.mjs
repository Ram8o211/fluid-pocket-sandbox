import { drawRabbit } from './RabbitRenderer.mjs';
import { rabbitArtwork, rabbitArtworkVersion } from './RabbitAssets.mjs';

import { visualResponse } from './RabbitPixelArt.mjs';
export { visualResponse } from './RabbitPixelArt.mjs';

/** Used by visual regressions; persistent exposure drives every channel. */
export function trialVisuals(subject, report, before = false) {
  const rabbit = before ? report?.beforeRabbit : report?.afterRabbit;
  const stats = rabbit?.stats || (before && report ? report.before : subject.stats);
  const exposure = rabbit?.exposure || (!before ? subject.exposure : {}) || {};
  const effects = !before && report ? report.effects : {};
  return {
    strength: visualResponse(Math.max(exposure.strength || 0, effects.strength || 0, (stats.strength - 20) / 80)),
    love: visualResponse(Math.max(exposure.love || 0, effects.love || 0, stats.love / 100)),
    transformation: visualResponse(Math.max(exposure.transformation || 0, effects.transformation || 0, stats.transformation / 100)),
    fire: visualResponse(Math.max(exposure.fire || 0, effects.fire || 0, stats.burning / 100)),
    freeze: visualResponse(Math.max(exposure.freeze || 0, effects.freeze || 0, stats.freezing / 100)),
    poison: visualResponse(Math.max(exposure.poison || 0, effects.poison || 0)),
    acidity: visualResponse(Math.max(exposure.acidity || 0, effects.acidity || 0)),
    death: visualResponse(Math.max(exposure.death || 0, effects.death || 0)),
    weakness: visualResponse(1 - stats.health / 100), alive: stats.alive
  };
}

function snapshot(subject, report, before) {
  if (report?.beforeRabbit) return structuredClone(before ? report.beforeRabbit : report.afterRabbit);
  const copy = structuredClone(subject);
  copy.stats = { ...(report ? before ? report.before : report.after : subject.stats) };
  if (report && !before) copy.exposure = { ...subject.exposure, ...report.effects };
  if (report && before) copy.exposure = Object.fromEntries(Object.keys(report.effects || {}).map(key => [key, 0]));
  return copy;
}

/** Replay is a picture of immutable snapshots, never another administration. */
export class TestingRenderer {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.subject = null; this.report = null; this.startedAt = null;
    this.lastTime = 0; this.lastPaint = 0; this.paused = false; this.dirty = true;
    this.frozenAt = 0; this.resume = false; this.before = false;
    this.untreated = null; this.treated = null;
  }
  replay() { this.startedAt = null; this.paused = false; this.resume = false; this.dirty = true; }
  togglePause() {
    this.paused = !this.paused;
    if (this.paused) { this.frozenAt = this.lastTime; this.pausedNow=Date.now(); } else this.resume = true;
    this.dirty = true; return this.paused;
  }
  render(subject, report, time, before = false) {
    if (!this.ctx || !subject) return;
    const artwork = rabbitArtworkVersion();
    if (this.artwork !== artwork) { this.artwork = artwork; this.dirty = true; }
    // A current condition view follows colony updates to the same rabbit object.
    // Recorded dose snapshots remain immutable while their replay is displayed.
    const liveSignature = report ? null : JSON.stringify(subject);
    if (this.subject !== subject || this.report !== report || this.liveSignature !== liveSignature) {
      this.subject = subject; this.report = report;
      this.liveSignature = liveSignature;
      this.untreated = snapshot(subject, report, true); this.treated = snapshot(subject, report, false);
      this.replay();
    }
    if (this.before !== before) { this.before = before; this.dirty = true; }
    if (!this.dirty && (this.paused || time - this.lastPaint < 32)) return;
    if (this.startedAt === null) this.startedAt = time;
    if (this.resume) { this.startedAt += time - this.frozenAt; this.resume = false; }
    const clock = this.paused ? this.frozenAt : time;
    this.lastTime = clock; this.lastPaint = time; this.dirty = false;
    const elapsed = Math.max(0, clock - this.startedAt);
    const progress = before ? 0 : !report ? 1 : Math.min(1, .35 + elapsed / 280);
    const current = structuredClone(progress < .8 ? this.untreated : this.treated);
    current.exposure ||= {};
    for (const key of Object.keys(this.treated.exposure || {})) current.exposure[key] = (this.untreated.exposure?.[key] || 0) + ((this.treated.exposure[key] || 0) - (this.untreated.exposure?.[key] || 0)) * progress;
    for (const key of Object.keys(this.treated.stats)) if (typeof this.treated.stats[key] === 'number') current.stats[key] = (this.untreated.stats[key] || 0) + (this.treated.stats[key] - (this.untreated.stats[key] || 0)) * progress;
    // Fatal burns extinguish in the simulation; replay their flames before the
    // terminal carbonized body, without changing either recorded snapshot.
    if (report && !before && elapsed < 1600 && this.treated.deathAppearance === 'charred' && report.doseExposure?.fire > report.doseExposure?.freeze) {
      current.activeFireUntil = (report.at ?? Date.now()) + 1600;
    }
    const ctx = this.ctx; ctx.save(); ctx.imageSmoothingEnabled = false; ctx.scale(this.canvas.width / 640, this.canvas.height / 350);
    const room = rabbitArtwork('room');
    if (room) ctx.drawImage(room, 0, 0, 640, 350);
    else {
    ctx.fillStyle='#32485a';ctx.fillRect(0,0,640,350);
    for(let y=36;y<300;y+=44)for(let x=-40+(y%88?40:0);x<640;x+=80){
      ctx.fillStyle='#3d5362';ctx.fillRect(x+2,y+2,76,40);
      ctx.fillStyle='#4b6370';ctx.fillRect(x+4,y+4,70,2);
    }
    ctx.strokeStyle = '#607075'; ctx.globalAlpha = .18; ctx.lineWidth = 1;
    for (let x = 0; x < 640; x += 42) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 350); ctx.stroke(); }
    for (let y = 25; y < 300; y += 35) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(640, y); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.fillStyle = '#788a62'; ctx.fillRect(0, 300, 640, 50);
    ctx.fillStyle='#b0bd82';ctx.fillRect(0,300,640,3);
    }
    ctx.strokeStyle = '#d6ae64'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(192, 0); ctx.lineTo(192, 350); ctx.stroke(); ctx.setLineDash([]);
    drawRabbit(ctx, this.untreated, 96, 297, 96, 0, { reference: true, now: report?.at ?? Date.now() });
    drawRabbit(ctx, current, 414, 304, 192, elapsed, { now: report ? report.at + elapsed : Date.now() });
    if (report && !before && elapsed < 1200) {
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, (elapsed - 650) / 550));
      ctx.save(); ctx.translate(395, 64); ctx.rotate(-.65); ctx.fillStyle = '#c0d8dd'; ctx.fillRect(-8, -24, 16, 30); ctx.fillStyle = report.sample?.color || '#ac9bdc'; ctx.fillRect(-6, -11, 12, 14); ctx.fillStyle = '#9b7451'; ctx.fillRect(-7, -28, 14, 6); ctx.restore();
      ctx.globalAlpha = 1;
    }
    const plaque = rabbitArtwork('plaque');
    if (plaque) ctx.drawImage(plaque, 278, 316, 272, 28);
    else { ctx.fillStyle = '#132c3a'; ctx.fillRect(278, 316, 272, 28); }
    ctx.textAlign = 'center'; ctx.fillStyle = '#e0d7c4'; ctx.font = '18px monospace'; ctx.fillText(`${subject.name} · ${subject.age === 'baby' ? 'baby' : 'adult'}`, 414, 336);
    ctx.restore();
  }
}
