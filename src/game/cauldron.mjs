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
