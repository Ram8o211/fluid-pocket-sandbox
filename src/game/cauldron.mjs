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
// Half-millilitre simulation parcels halve new-brew particle counts while
// their mass-scaled radius preserves the same 2D liquid footprint. Existing
// .25 ml saves remain valid.
export const PARTICLE_ML = .5;
export const PARTICLE_CAPACITY = 2304;
// Includes sprite rounding at both 384px and battery-mode 192px resolutions.
export const WALL_CLEARANCE = .05;
const PLANES = CAULDRON_INTERIOR.map(([x, y], i) => {
  const next = CAULDRON_INTERIOR[(i + 1) % CAULDRON_INTERIOR.length];
  const dx = next[0] - x, dy = next[1] - y, length = Math.hypot(dx, dy);
  return { x, y, nx: dy / length, ny: -dx / length };
});

// Native particle contacts and the game boundary use this same inset. Shifting
// only one collider makes pressure push parcels into a different wall every
// tick, especially after partial bottling changes the native radius.
export const CAULDRON_NATIVE_INTERIOR = Object.freeze(CAULDRON_INTERIOR.map(([x, y], i) => {
  const a = PLANES[(i + PLANES.length - 1) % PLANES.length], b = PLANES[i];
  const scale = WALL_CLEARANCE / (1 + a.nx * b.nx + a.ny * b.ny);
  return Object.freeze([x + (a.nx + b.nx) * scale, y + (a.ny + b.ny) * scale]);
}));

export function cauldronParticlePadding(ps, i) {
  if (ps.phase[i] === Phase.LIQUID && ps.nativeLiquidRadius > 0)
    return ps.nativeLiquidRadius + WALL_CLEARANCE;
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

// A compressible gas has a pressure gradient at a sealed wall, before its
// parcel centres hit the collision plane. Pressure follows concentration and
// temperature; it balances buoyancy without artificial lid restitution or
// large random kicks. It is integrated once per physics tick.
export function cauldronGasWallPressure(ps, i, dt) {
  const padding = cauldronParticlePadding(ps, i);
  const reach = Math.max(.12, effectiveParticleRadius(ps, i, true) * 6.6);
  const pressure = 2 * Math.min(12, Math.max(.2, ps.localGasDensity[i])) *
    Math.max(.3, Math.min(1.2, ps.temperature[i] + .25));
  for (const p of PLANES) {
    const gap = (ps.x[i] - p.x) * p.nx + (ps.y[i] - p.y) * p.ny - padding;
    const q = Math.max(0, Math.min(1, 1 - gap / reach));
    ps.vx[i] += p.nx * q * q * pressure * dt;
    ps.vy[i] += p.ny * q * q * pressure * dt;
  }
}

export function confineCauldronParticle(ps, i) {
  const padding = cauldronParticlePadding(ps, i);
  // Repeated projections resolve contact with two planes at tapered corners.
  for (let pass = 0; pass < 6; pass++) {
    let contact = false;
    for (const p of PLANES) {
      const distance = (ps.x[i] - p.x) * p.nx + (ps.y[i] - p.y) * p.ny;
      // Small normal fluctuations at the supported bottom layer must decay
      // rather than become a repeated upward launch. Leave actual stirring,
      // large splashes, free streams and the gas layer untouched.
      if (ps.phase[i] === Phase.LIQUID && p.ny > .8 &&
          distance - padding < .035 && ps.stirActivity[i] < .025) {
        const outward = ps.vx[i] * p.nx + ps.vy[i] * p.ny;
        if (outward > 0 && outward < .5) {
          ps.vx[i] -= p.nx * outward * .45;
          ps.vy[i] -= p.ny * outward * .45;
        }
      }
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
         // Vapour pressure provides thickness; lid collisions must not inject
         // fresh kinetic energy into either phase.
         const rebound = 1;
        ps.vx[i] -= p.nx * normalSpeed * rebound;
        ps.vy[i] -= p.ny * normalSpeed * rebound;
        if (granular) {
          const tangentX = -p.ny, tangentY = p.nx;
          const slip = ps.vx[i]*tangentX + ps.vy[i]*tangentY;
          ps.vx[i] -= tangentX*slip*.36;
          ps.vy[i] -= tangentY*slip*.36;
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
