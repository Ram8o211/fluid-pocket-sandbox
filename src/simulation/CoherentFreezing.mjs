import { Phase } from './Phase.mjs';
import { targetPhaseAt } from './PhaseSolver.mjs';

// Freezing is a change of *bulk* mechanics, not the emission of individual ice
// grains. Keep the liquid solver in charge while the connected cold region
// crystallizes optically, then transfer its actual, current silhouette to one
// coherent rigid body in a single handoff. Separate droplets stay separate.
export function freezeConnectedLiquids(ps, grid, solid, planar = false) {
  const parent = new Int32Array(ps.count).fill(-1);
  let candidates = 0;
  for (let i = 0; i < ps.count; i++) {
    if (ps.phase[i] !== Phase.LIQUID || ps.phaseTarget[i] !== Phase.SOLID ||
        ps.phaseProgress[i] <= 0 || targetPhaseAt(ps, i) !== Phase.SOLID) continue;
    parent[i] = i;
    candidates++;
  }
  if (!candidates) return 0;
  const root = i => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  // The native liquid centers can be farther apart than the visible parcel
  // radii. Connect overlapping/contacting regions, never distant splashes.
  const reach = Math.max(.19, (ps.nativeLiquidRadius || .055) * 3.6);
  grid.forEachPair(ps, reach, (i, j) => {
    if (parent[i] < 0 || parent[j] < 0) return;
    const a = root(i), b = root(j);
    if (a !== b) parent[b] = a;
  });
  const components = new Map();
  for (let i = 0; i < ps.count; i++) {
    if (parent[i] < 0) continue;
    const id = root(i);
    if (!components.has(id)) components.set(id, []);
    components.get(id).push(i);
  }
  // IDs saved with earlier frozen bodies must not be reused after a restore.
  for (let i = 0; i < ps.count; i++) {
    if (ps.solidBodyId[i] >= solid.nextBodyId) solid.nextBodyId = ps.solidBodyId[i] + 1;
  }
  let converted = 0;
  for (const indices of components.values()) {
    // A single cold area must never generate dozens of free-falling colliders
    // while its individual nucleation clocks are still completing.
    if (indices.some(i => ps.phaseProgress[i] < 1 - 1e-6)) continue;
    let cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0, mass = 0;
    for (const i of indices) {
      const m = Math.max(.000001, ps.mass[i]);
      mass += m;
      cx += ps.x[i] * m; cy += ps.y[i] * m; cz += ps.z[i] * m;
      vx += ps.vx[i] * m; vy += ps.vy[i] * m; vz += ps.vz[i] * m;
    }
    cx /= mass; cy /= mass; cz = planar ? 0 : cz / mass;
    vx /= mass; vy /= mass; vz = planar ? 0 : vz / mass;
    const id = solid.nextBodyId++;
    solid.bodyOrigins.set(id, { x: cx, y: cy, z: cz });
    for (const i of indices) {
      // A crystallized liquid is compact ice, not crushed/granular ingredient.
      ps.setPhase(i, Phase.SOLID);
      ps.solidSubdivision[i] = 0;
      // Preserve the water footprint in the rigid collider; expanding every
      // fixture at solidification would squeeze the block against the walls.
      ps.frozenRadius[i] = ps.nativeLiquidRadius || .039 * Math.sqrt(Math.max(.0001, ps.mixtureAmount[i]) / .25);
      ps.solidBodyId[i] = id;
      ps.solidLocalX[i] = ps.x[i] - cx;
      ps.solidLocalY[i] = ps.y[i] - cy;
      ps.solidLocalZ[i] = planar ? 0 : ps.z[i] - cz;
      ps.vx[i] = vx; ps.vy[i] = vy; ps.vz[i] = vz;
      converted++;
    }
  }
  return converted;
}
