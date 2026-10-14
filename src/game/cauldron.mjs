import { effectiveParticleRadius } from '../simulation/FluidSolver.mjs';
import { isPowder } from '../simulation/PowderSolver.mjs';
import { Phase } from '../simulation/Phase.mjs';

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

// Only the upward-facing lower bowl touches the flame/Frost plate. The upper
// walls and lid cannot apply the source directly to falling or remote parcels.
export function cauldronBottomContact(ps, i) {
  const padding = cauldronParticlePadding(ps, i);
  let contact = 0;
  for (const p of PLANES) {
    if (p.ny < .6) continue;
    const gap = (ps.x[i] - p.x) * p.nx + (ps.y[i] - p.y) * p.ny - padding;
    contact = Math.max(contact, Math.max(0, Math.min(1, 1 - gap / .10)));
  }
  return contact;
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
        // Dry grains and dough lose all inward normal speed: a collision may
        // stop or redirect sliding but must never reverse into elastic recoil.
        const granular = isPowder(ps,i);
        // Liquid and granular contacts are inelastic: the old 3% liquid
         // restitution repeatedly re-injected energy at the floor.
         // Gas keeps its small rebound so steam retains vertical thickness.
         const rebound = granular || ps.phase[i] === Phase.LIQUID ? 1 : 1.03;
        ps.vx[i] -= p.nx * normalSpeed * rebound;
        ps.vy[i] -= p.ny * normalSpeed * rebound;
        if (granular || ps.phase[i] === Phase.LIQUID) {
          // Mild inelastic wall friction dissipates the last contact jitter
          // in supported liquid layers, without damping free flowing streams.
          const tangentX = -p.ny, tangentY = p.nx;
          const slip = ps.vx[i]*tangentX + ps.vy[i]*tangentY;
          const friction = granular ? .36 : .16;
          ps.vx[i] -= tangentX*slip*friction;
          ps.vy[i] -= tangentY*slip*friction;
        }
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


// An actual inward-facing bowl normal opposing gravity provides granular
// support. Only near-surface grains qualify; empty space never suspends powder.
export function cauldronGranularWallSupport(ps,i,gravity) {
  const length=Math.hypot(gravity.x,gravity.y)||1;
  const againstX=-gravity.x/length,againstY=-gravity.y/length;
  const padding=cauldronParticlePadding(ps,i);
  // Only near-horizontal floor planes can cancel gravity outright. Inclined
  // copper walls must let sand slide toward the bottom, not pin grains in place.
  return PLANES.some(p=>p.nx*againstX+p.ny*againstY>.85
    && (ps.x[i]-p.x)*p.nx+(ps.y[i]-p.y)*p.ny-padding<.005);
}

// A rigid block hits the pot as a whole: never project its individual grains
// independently, which bends a frozen body at the tapered floor.
export function confineCauldronBodies(ps) {
  const groups=new Map();
  for(let i=0;i<ps.count;i++){
    const id=ps.phase[i]===0&&ps.solidSubdivision[i]<.55?ps.solidBodyId[i]:0;
    if(!id){confineCauldronParticle(ps,i);continue;}
    if(!groups.has(id))groups.set(id,[]);groups.get(id).push(i);
  }
  for(const indices of groups.values())for(let pass=0;pass<6;pass++){
    let touched=false;
    for(const p of PLANES){
      let penetration=0;
      for(const i of indices)penetration=Math.max(penetration,cauldronParticlePadding(ps,i)-(ps.x[i]-p.x)*p.nx-(ps.y[i]-p.y)*p.ny);
      if(penetration<=0)continue;touched=true;
      let mass=0,vx=0,vy=0;for(const i of indices){mass+=ps.mass[i];vx+=ps.vx[i]*ps.mass[i];vy+=ps.vy[i]*ps.mass[i];}
      const normal=(vx*p.nx+vy*p.ny)/Math.max(.00001,mass);
      for(const i of indices){ps.x[i]+=p.nx*penetration;ps.y[i]+=p.ny*penetration;if(normal<0){ps.vx[i]-=p.nx*normal;ps.vy[i]-=p.ny*normal;}}
    }
    if(!touched)break;
  }
}
