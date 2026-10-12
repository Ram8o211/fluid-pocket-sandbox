import { effectiveParticleRadius } from '../simulation/FluidSolver.mjs';

// One clockwise cutaway outline, in simulation units, for both the visible
// copper walls and their collision planes. The top plane is the sealed lid.
export const CAULDRON_INTERIOR = Object.freeze([
  [-2.35, 1.2], [2.35, 1.2], [2.35, .6], [2.05, -.4],
  [1.65, -.925], [1.275, -1.2], [-1.275, -1.2],
  [-1.65, -.925], [-2.05, -.4], [-2.35, .6]
].map(point => Object.freeze(point)));
export const PARTICLE_ML = .25;
export const PARTICLE_CAPACITY = 2304;
// Includes sprite rounding at both 384px and battery-mode 192px resolutions.
export const WALL_CLEARANCE = .05;
const PLANES = CAULDRON_INTERIOR.map(([x, y], i) => {
  const next = CAULDRON_INTERIOR[(i + 1) % CAULDRON_INTERIOR.length];
  const dx = next[0] - x, dy = next[1] - y, length = Math.hypot(dx, dy);
  return { x, y, nx: dy / length, ny: -dx / length };
});

export function cauldronParticlePadding(ps, i) {
  return effectiveParticleRadius(ps, i, true) + WALL_CLEARANCE;
}

export function insideCauldron(x, y, padding = 0) {
  return PLANES.every(p => (x - p.x) * p.nx + (y - p.y) * p.ny >= padding - .000002);
}

export function confineCauldronParticle(ps, i) {
  const padding = cauldronParticlePadding(ps, i);
  // Repeated projections resolve contact with two planes at tapered corners.
  for (let pass = 0; pass < 6; pass++) {
    let contact = false;
    for (const p of PLANES) {
      const distance = (ps.x[i] - p.x) * p.nx + (ps.y[i] - p.y) * p.ny;
      if (distance >= padding) continue;
      ps.x[i] += p.nx * (padding - distance);
      ps.y[i] += p.ny * (padding - distance);
      const normalSpeed = ps.vx[i] * p.nx + ps.vy[i] * p.ny;
      if (normalSpeed < 0) {
        ps.vx[i] -= p.nx * normalSpeed * 1.03;
        ps.vy[i] -= p.ny * normalSpeed * 1.03;
      }
      contact = true;
    }
    if (!contact) break;
  }
}

export function traceCauldron(ctx, transform) {
  ctx.beginPath();
  CAULDRON_INTERIOR.forEach(([x, y], i) => {
    const px = transform.cx + x * transform.scale, py = transform.cy - y * transform.scale;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.closePath();
}
