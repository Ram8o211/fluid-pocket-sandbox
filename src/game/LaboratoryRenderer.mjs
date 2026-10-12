import { PlanarRenderer } from '../rendering/PlanarRenderer.mjs';
import { Phase } from '../simulation/Phase.mjs';
import { workshopBackground } from './art.mjs';
import { effectiveParticleRadius } from '../simulation/FluidSolver.mjs';
import { traceCauldron } from './cauldron.mjs';

// Reuses the existing planar renderer's particle colours, effects and picking
// contract. The laboratory is a low-resolution, pixel-scaled 2D canvas only.
export class LaboratoryRenderer extends PlanarRenderer {
  constructor(canvas, brew) {
    super(canvas, brew.engine); this.brew = brew; this.background = workshopBackground();
    this.quality = 'balanced'; this.spoon = null; this.frame = 0; this.resize(true);
  }
  resize() {
    const scale = this.quality === 'eco' ? .5 : 1;
    if (this.canvas.width !== 384 * scale) { this.canvas.width = 384 * scale; this.canvas.height = 232 * scale; }
  }
  transform() { const factor = this.canvas.width / 384; return { w: this.canvas.width, h: this.canvas.height, scale: 40 * factor, cx: 192 * factor, cy: 158 * factor }; }
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
    if (this.brew.cool) { rect(327, 193, 16, 14, '#8cdbe2'); rect(331, 189, 8, 21, '#bbf4ec'); rect(323, 196, 24, 6, '#8cdbe2'); }
    // Capacity ruler is a measurement, not a replacement fluid graphic.
    rect(82, 147, 2, 49, '#b59a78');
    for (let i = 0; i < 5; i++) rect(78, 148 + i * 11, 6, 2, '#d0b387');
    ctx.restore();
    ctx.save(); traceCauldron(ctx, t); ctx.clip();
    this.drawFluid(ctx, t);
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
    if (this.brew.vaporVolume > .01) {
      // Droplets are visible inside the cutaway, under the cooling lid.
      for (let i = 0; i < 6; i++) {
        const x = 113 + i * 30, y = 114 + ((this.frame + i * 11) % 19);
        rect(x, y, 1, 3, '#a7d9d1');
      }
    }
    if (this.brew.lastPour && this.sim.time < this.brew.lastPour.until) {
      const x = 192 + this.brew.lastPour.x * 40;
      rect(x - 8, 76, 16, 13, '#c1cfc2'); rect(x - 5, 79, 10, 9, this.brew.lastPour.color); rect(x - 3, 90, 6, 14, this.brew.lastPour.color);
    }
    if (this.spoon) {
      const x = 192 + this.spoon.x * 40, y = 158 - this.spoon.y * 40;
      ctx.strokeStyle = '#312237'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(x + 35, y - 47); ctx.lineTo(x, y); ctx.stroke();
      ctx.strokeStyle = '#cea478'; ctx.lineWidth = 5; ctx.stroke(); rect(x - 5, y - 2, 11, 8, '#e3b784'); rect(x - 3, y + 2, 7, 4, '#ae724d');
    }
    ctx.restore(); this.frame++;
  }
  drawFluid(ctx, t) {
    const ps = this.sim.ps, c = this.colorScratch, pixel = 1;
    for (let i = 0; i < ps.count; i++) {
      this.particleColor(ps, i, c);
      const x = Math.round((t.cx + ps.x[i] * t.scale) / pixel) * pixel, y = Math.round((t.cy - ps.y[i] * t.scale) / pixel) * pixel;
      const radius = Math.max(pixel, effectiveParticleRadius(ps, i, true) * t.scale);
      const r = Math.ceil(radius / pixel) * pixel;
      ctx.globalAlpha = ps.phase[i] === Phase.GAS ? .24 : .93;
      ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
      ctx.fillRect(x - r, y - r + pixel, r * 2, Math.max(pixel, r * 2 - pixel * 2));
      ctx.fillRect(x - r + pixel, y - r, Math.max(pixel, r * 2 - pixel * 2), r * 2);
      if (ps.phase[i] === Phase.SOLID) { ctx.fillStyle = '#c1d9d2'; ctx.globalAlpha = .45; ctx.fillRect(x, y, pixel, pixel); }
      else if (ps.phase[i] === Phase.LIQUID && i % 16 === 0) { ctx.fillStyle = '#e6f9e1'; ctx.globalAlpha = .17; ctx.fillRect(x, y - r, pixel, pixel); }
    }
    ctx.globalAlpha = 1;
  }
}
