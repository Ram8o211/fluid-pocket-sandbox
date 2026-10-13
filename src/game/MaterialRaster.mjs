import { effectiveParticleRadius } from '../simulation/FluidSolver.mjs';
import { isPowder } from '../simulation/PowderSolver.mjs';
import { Phase } from '../simulation/Phase.mjs';

/** Paint all matter into one reusable RGBA buffer. Texels are always one pixel;
 * physical footprints and mass are independent of the display resolution.
 * This avoids thousands of canvas calls and colour strings every frame. */
export function paintMaterialParticles(ps, t, pixels, particleColor, colorScratch) {
  pixels.fill(0);
  for (let i = 0; i < ps.count; i++) {
    particleColor(ps, i, colorScratch);
    const x = Math.round(t.cx + ps.x[i] * t.scale), y = Math.round(t.cy - ps.y[i] * t.scale);
    const phase = ps.phase[i], dry = isPowder(ps, i) && ps.powderContent[i] > .85;
    const diameter = Math.max(1, Math.ceil(effectiveParticleRadius(ps, i, true) * t.scale * 2));
    const variation = dry ? .13 : phase === Phase.SOLID ? .07 : phase === Phase.GAS ? .04 : .025;
    const alpha = phase === Phase.GAS ? .24 : phase === Phase.LIQUID ? .96 : .99;
    const originY = y - Math.floor(diameter / 2), originX = x - Math.floor(diameter / 2);
    const top = Math.max(0, originY), bottom = Math.min(t.h, originY + diameter);
    const left = Math.max(0, originX), right = Math.min(t.w, originX + diameter);
    for (let py = top; py < bottom; py++) for (let px = left; px < right; px++) {
      const ox = px - x, oy = py - y;
      const hash = ((i * 67 + ox * 23 + oy * 41) >>> 0) % 11 - 5;
      const shade = 1 + variation * hash / 5;
      const index = (py * t.w + px) * 4, oldAlpha = pixels[index + 3] / 255;
      if(oldAlpha===0){pixels[index]=colorScratch.r*shade;pixels[index+1]=colorScratch.g*shade;pixels[index+2]=colorScratch.b*shade;pixels[index+3]=alpha*255;continue;}
      const outAlpha = alpha + oldAlpha * (1 - alpha), oldWeight = oldAlpha * (1 - alpha);
      pixels[index] = (colorScratch.r * shade * alpha + pixels[index] * oldWeight) / outAlpha;
      pixels[index + 1] = (colorScratch.g * shade * alpha + pixels[index + 1] * oldWeight) / outAlpha;
      pixels[index + 2] = (colorScratch.b * shade * alpha + pixels[index + 2] * oldWeight) / outAlpha;
      pixels[index + 3] = outAlpha * 255;
    }
    // A single fine grit texel distinguishes touching grains without drawing
    // a connected solid skin, artificial outlines or large holes in the pile.
    if (dry && x >= 0 && x < t.w && y >= 0 && y < t.h) {
      const index = (y * t.w + x) * 4;
      pixels[index] *= .68; pixels[index + 1] *= .68; pixels[index + 2] *= .68;
    }
  }
  return ps.count;
}
