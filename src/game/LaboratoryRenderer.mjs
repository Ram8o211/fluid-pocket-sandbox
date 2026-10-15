import { PlanarRenderer } from '../rendering/PlanarRenderer.mjs';
import { Phase } from '../simulation/Phase.mjs';
import { workshopBackground, magicGlowSprite } from './art.mjs';
import { effectiveParticleRadius } from '../simulation/FluidSolver.mjs';
import { traceCauldron } from './cauldron.mjs';
import { mixedMagicGlow, particleMagicAuras, paintParticleMagicLights } from './magicLight.mjs';
import { paintMaterialParticles } from './MaterialRaster.mjs';
import { FluidSurfaceGPU } from './FluidSurfaceGPU.mjs';

const MAGIC_GLOW_LIMIT = 160;

// Reuses the existing planar renderer's particle colours, effects and picking
// contract. The laboratory is a low-resolution, pixel-scaled 2D canvas only.
export class LaboratoryRenderer extends PlanarRenderer {
  constructor(canvas, brew) {
    super(canvas, brew.engine); this.brew = brew; this.background = workshopBackground();
    this.quality = 'balanced'; this.spoon = null; this.frame = 0; this.graphics.effectsScale = 1;
    this.glowSprites = new Map();
    this.magicX = new Float32Array(MAGIC_GLOW_LIMIT); this.magicY = new Float32Array(MAGIC_GLOW_LIMIT);
    this.magicColor = new Array(MAGIC_GLOW_LIMIT); this.magicIntensity = new Float32Array(MAGIC_GLOW_LIMIT);
    this.fluidGPU = FluidSurfaceGPU.create(canvas.ownerDocument);
    this.materialColor = (ps, i, out) => this.particleColor(ps, i, out);
    this.magicCount = 0; this.resize(true);
  }
  resize() {
    const scale = this.quality === 'eco' ? 1 : Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
    if (this.canvas.width !== 384 * scale) { this.canvas.width = 384 * scale; this.canvas.height = 232 * scale; }
  }
  transform() { const factor = this.canvas.width / 384; return { w: this.canvas.width, h: this.canvas.height, scale: 40 * factor, cx: 192 * factor, cy: 158 * factor }; }
  fittedCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    const scale = Math.max(.0001, Math.min(rect.width / this.canvas.width, rect.height / this.canvas.height));
    return { scale, left: rect.left + (rect.width - this.canvas.width * scale) / 2,
      top: rect.top + (rect.height - this.canvas.height * scale) / 2 };
  }
  screenToWorld(clientX, clientY) {
    const fit = this.fittedCanvas(), t = this.transform();
    return { x: ((clientX - fit.left) / fit.scale - t.cx) / t.scale,
      y: -((clientY - fit.top) / fit.scale - t.cy) / t.scale, z: 0 };
  }
  projectWorldToScreen(x, y) {
    const fit = this.fittedCanvas(), t = this.transform();
    return { x: fit.left + (t.cx + x * t.scale) * fit.scale,
      y: fit.top + (t.cy - y * t.scale) * fit.scale };
  }
  setQuality(quality) { this.quality = quality; this.resize(); }
  render() {
    this.resize(); const ctx = this.ctx, factor = this.canvas.width / 384, t = this.transform();
    if (!ctx || !this.background) return;
    ctx.imageSmoothingEnabled = false; ctx.globalAlpha = 1; ctx.drawImage(this.background, 0, 0, 384, 232, 0, 0, t.w, t.h);
    ctx.save(); ctx.scale(factor, factor);
    const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
    const polygon = (points, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(...points[0]); for (const p of points.slice(1)) ctx.lineTo(...p); ctx.closePath(); ctx.fill(); };
    // Copper walls surround the exact same polygon that confines every phase.
    // The interior is a cutaway, so the player can see the real fluid and steam.
    traceCauldron(ctx, { cx: 192, cy: 158, scale: 40 });
    ctx.lineJoin = 'bevel'; ctx.strokeStyle = '#211b2c'; ctx.lineWidth = 18; ctx.stroke();
    ctx.strokeStyle = '#9e613e'; ctx.lineWidth = 12; ctx.stroke();
    ctx.strokeStyle = '#d4a268'; ctx.lineWidth = 8; ctx.stroke();
    ctx.fillStyle = '#222536'; ctx.fill();
    rect(54, 113, 26, 7, '#bf884f'); rect(54, 120, 7, 22, '#a9663f'); rect(61, 138, 26, 7, '#945335');
    rect(304, 113, 26, 7, '#bf884f'); rect(323, 120, 7, 22, '#a9663f'); rect(298, 138, 25, 7, '#945335');
    rect(116, 207, 152, 7, '#412c32'); rect(121, 205, 142, 3, '#bc8750');
    rect(121, 214, 12, 14, '#2a202c'); rect(251, 214, 12, 14, '#2a202c');
    rect(146, 221, 92, 14, '#38313c'); rect(150, 222, 84, 4, '#615058');
    if (this.brew.heat) {
      const frame = Math.floor(this.frame / 5);
      for (let i = 0; i < 9; i++) { const h = 5 + ((i * 11 + frame * 7) % 17) * this.brew.heat; rect(157 + i * 8, 224 - h, 6, h, i % 2 ? '#e78544' : '#b94e38'); rect(159 + i * 8, 223 - h * .55, 2, h * .55 + 2, '#ffd185'); }
    }
    if (this.brew.cool) { rect(180, 222, 24, 6, '#8cdbe2'); rect(187, 216, 10, 14, '#bbf4ec'); rect(184, 220, 16, 6, '#8cdbe2'); }
    // Capacity ruler is a measurement, not a replacement fluid graphic.
    rect(82, 147, 2, 49, '#b59a78');
    for (let i = 0; i < 5; i++) rect(78, 148 + i * 11, 6, 2, '#d0b387');
    ctx.restore();
    ctx.save(); traceCauldron(ctx, t); ctx.clip();
    this.drawFluid(ctx, t);
    this.drawMagicGlows(ctx, t);
    this.drawEffects(ctx, t); ctx.restore(); ctx.globalAlpha = 1;
    ctx.save(); ctx.scale(factor, factor);
    rect(80, 100, 224, 4, '#e0b675'); rect(78, 104, 228, 5, '#b67642'); rect(80, 109, 224, 3, '#64383a');
    // Fitted copper lid. Small self-sealing ports admit the spoon and reagents
    // without giving the retained vapour an open escape path.
    polygon([[78, 100], [78, 96], [96, 96], [96, 88], [124, 88], [124, 83], [260, 83], [260, 88], [288, 88], [288, 96], [306, 96], [306, 100]], '#533b3a');
    rect(99, 91, 186, 7, '#a96642'); rect(127, 86, 130, 5, '#bc884f');
    rect(128, 84, 128, 2, '#e0b675'); rect(184, 74, 16, 9, '#332a32');
    rect(187, 73, 10, 4, '#d7ad68'); rect(99, 98, 186, 2, '#e0b675');
    for (const x of [144, 240]) { rect(x - 7, 89, 14, 9, '#463441'); rect(x - 4, 90, 8, 5, '#a7b9a9'); }
    // Condensation effects follow real local gas -> liquid progress. A hot pot
    // must not keep drawing a cold-lid drizzle merely because steam is present.
    const ps = this.sim.ps;
    ctx.save(); traceCauldron(ctx, { cx: 192, cy: 158, scale: 40 }); ctx.clip();
    let drops = 0;
    for (let i = 0; i < ps.count && drops < 6; i++) {
      if (ps.phase[i] !== Phase.GAS || ps.phaseProgress[i] <= 0 || ps.temperature[i] >= ps.boilingTemperature[i] - ps.phaseHysteresis[i]) continue;
      const x = 192 + ps.x[i] * 40, y = 158 - ps.y[i] * 40;
      rect(x, y + ((this.frame + i * 11) % 5), 1, 3, '#a7d9d1'); drops++;
    }
    ctx.restore();
    if (this.brew.lastPour && this.sim.time < this.brew.lastPour.until) {
      const x = 192 + this.brew.lastPour.x * 40;
      rect(x - 8, 76, 16, 13, '#c1cfc2'); rect(x - 5, 79, 10, 9, this.brew.lastPour.color);
      if (this.brew.lastPour.form !== 'liquid' && this.brew.lastPour.form !== 'water' && this.brew.lastPour.form) { for (let n=0;n<5;n++) rect(x - 3 + (n%3)*2, 90 + (n*5+this.frame)%14, 2, 2, this.brew.lastPour.color); }
      else rect(x - 3, 90, 6, 14, this.brew.lastPour.color);
    }
    if (this.spoon) {
      const x = 192 + this.spoon.x * 40, y = 158 - this.spoon.y * 40;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = '#302330'; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(x + 34, y - 49); ctx.lineTo(x, y); ctx.stroke();
      ctx.strokeStyle = this.tool === 'pestle' ? '#a8b4b6' : '#a96e40'; ctx.lineWidth = 6; ctx.stroke();
      ctx.strokeStyle = '#dfb47c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 32, y - 49); ctx.lineTo(x - 1, y - 4); ctx.stroke();
      if (this.tool === 'pestle') { rect(x - 6, y - 5, 12, 13, '#75858d'); rect(x - 4, y - 5, 8, 3, '#ced6ce'); rect(x - 7, y + 5, 14, 3, '#4c5a65'); }
      else {
        ctx.save(); ctx.translate(x, y); ctx.rotate(.55);
        ctx.fillStyle = '#74472e'; ctx.beginPath(); ctx.ellipse(0,0,12,17,0,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = '#c3945c'; ctx.beginPath(); ctx.ellipse(-1,-2,10,14,0,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = '#8b5939'; ctx.beginPath(); ctx.ellipse(-1,-3,7,10,0,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#e3bd85'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(-1,-3,8,11,0,Math.PI,Math.PI*1.7);ctx.stroke();ctx.restore();
      }
    }
    ctx.restore(); this.frame++;
  }
  getGlowSprite(colour) {
    if (!this.glowSprites) this.glowSprites = new Map();
    let sprite = this.glowSprites.get(colour);
    if (sprite) return sprite;
    sprite = magicGlowSprite(colour);
    // Per-renderer LRU. Quantized palette also bounds global sprite variants.
    if (this.glowSprites.size >= 96) this.glowSprites.delete(this.glowSprites.keys().next().value);
    this.glowSprites.set(colour, sprite);
    return sprite;
  }
  drawMagicGlows(ctx, t) {
    this.magicCount = 0;
    const effectsScale = Math.max(0, Math.min(1, this.graphics?.effectsScale ?? 1));
    if (effectsScale <= .01) return;
    const ps = this.sim.ps, limit = Math.max(1, Math.round((this.quality === 'eco' ? 48 : MAGIC_GLOW_LIMIT) * effectsScale));
    const stride = Math.max(1, Math.ceil(ps.count / limit));
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < ps.count; i += stride) {
      const aura = this.magicAuras?.length === ps.count ? this.magicAuras[i] : mixedMagicGlow(ps, i);
      if (!aura) continue;
      const x = Math.round(t.cx + ps.x[i] * t.scale), y = Math.round(t.cy - ps.y[i] * t.scale);
      const stirring = Math.min(1, Math.hypot(ps.vx[i], ps.vy[i]) * .45);
      const warm = Math.max(0, Math.min(1, (ps.temperature[i] - .28) * 2));
      const mixed = ps.mixtureProgress[i] || 0;
      const activity = Math.min(1, stirring * .65 + warm * .45 + mixed * .3);
      const pulse = .94 + .06 * Math.sin(this.sim.time * (2 + activity * 3) + i * .7);
      const radius = Math.max(t.scale / 40 * 4, effectiveParticleRadius(ps, i, true) * t.scale * 2.5) *
        (1 + aura.intensity * .45 + activity * .15);
      ctx.globalAlpha = Math.min(1, (.15 + aura.intensity * .7) * (1 + activity * .18) * pulse * effectsScale);
      ctx.drawImage(this.getGlowSprite(aura.color), x - radius, y - radius, radius * 2, radius * 2);
      const mark = this.magicCount++;
      this.magicX[mark] = x; this.magicY[mark] = y; this.magicColor[mark] = aura.color;
      this.magicIntensity[mark] = aura.intensity * (.7 + activity * .3);
    }
    ctx.restore();
  }
  drawEffects(ctx, t) {
    const ps = this.sim.ps;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    // Sparse bright texels keep the sampled halos legible on opaque grains,
    // while the original ingredient colours remain visible in the liquid.
    const texel = Math.max(1, Math.round(t.scale / 40)), effectsScale = Math.max(0, Math.min(1, this.graphics?.effectsScale ?? 1));
    for (let i = 0; effectsScale > .01 && i < this.magicCount; i += this.quality === 'eco' ? 3 : 2) {
      const pulse = .75 + .25 * Math.sin(this.sim.time * 3 + i * 2.3);
      ctx.globalAlpha = (.12 + this.magicIntensity[i] * .25) * pulse * effectsScale;
      ctx.fillStyle = this.magicColor[i];
      ctx.fillRect(this.magicX[i], this.magicY[i] - texel, texel, texel);
    }
    for (let i = 0; i < ps.count; i++) {
      if (ps.combustionProgress[i] <= 0 || ps.temperature[i] < ps.combustionTemperature[i]) continue;
      const x = Math.round(t.cx + ps.x[i] * t.scale), y = Math.round(t.cy - ps.y[i] * t.scale);
      const radius = Math.max(1, effectiveParticleRadius(ps, i, true) * t.scale);
      // Every active burning parcel emits its own small light, including in eco mode.
      const flicker = .8 + .2 * Math.sin(this.sim.time * 19 + i * 2.4);
      ctx.globalAlpha = (.12 + .1 * ps.combustionProgress[i]) * flicker;
      ctx.fillStyle = '#ff793e'; ctx.fillRect(x-radius*2,y-radius*2,radius*4,radius*4);
      ctx.globalAlpha = .65 * flicker; ctx.fillStyle = '#ffd687'; ctx.fillRect(x-1,y-2,2,3);
    }
    const events = this.sim.reactions;
    for (let i = 0; i < events.eventCount; i++) {
      const x = Math.round(t.cx + events.eventX[i] * t.scale), y = Math.round(t.cy - events.eventY[i] * t.scale);
      ctx.globalAlpha = .3; ctx.fillStyle = '#ffd687'; ctx.fillRect(x-1,y-1,2,2);
    }
    ctx.restore();
  }
  drawFluid(ctx, t) {
    const ps = this.sim.ps;
    this.magicAuras = particleMagicAuras(ps, this.sim.reactions?.mixtures);
    if (this.fluidGPU?.render(ps, t, this.materialColor, this.colorScratch,
        this.magicAuras, this.graphics?.effectsScale ?? 1, this.quality === 'eco' ? 20 : 40)) {
      this.drawCount = ps.count;
      this.glowingParticleCount = this.fluidGPU.stats.glowingParticles;
      this.materialBackend = 'webgl2';
      ctx.globalAlpha = 1; this.fluidGPU.composite(ctx, t);
      return;
    }
    this.materialBackend = 'canvas';
    if (!this.matterLayer) {
      this.matterLayer = this.canvas.ownerDocument.createElement('canvas');
      this.matterContext = this.matterLayer.getContext('2d');
    }
    if (this.matterLayer.width !== t.w || this.matterLayer.height !== t.h || !this.matterPixels) {
      this.matterLayer.width = t.w; this.matterLayer.height = t.h;
      this.matterPixels = this.matterContext.createImageData(t.w, t.h);
    }
    this.drawCount = paintMaterialParticles(ps, t, this.matterPixels.data,
      this.materialColor, this.colorScratch);
    // The broad animated halos remain sampled for speed; this raster pass
    // lights every actual particle with its live (or homogeneous) mixture magic.
    this.glowingParticleCount = paintParticleMagicLights(ps, t, this.matterPixels.data,
      this.magicAuras, this.graphics?.effectsScale ?? 1);
    this.matterContext.putImageData(this.matterPixels, 0, 0);
    ctx.globalAlpha = 1; ctx.drawImage(this.matterLayer, 0, 0);
  }
  dispose() {
    this.fluidGPU?.dispose();
    this.glowSprites?.clear();
    this.matterLayer = this.matterContext = this.matterPixels = this.magicAuras = null;
  }
}

