import { Phase } from '../simulation/Phase.mjs';
import { effectiveParticleRadius } from '../simulation/FluidSolver.mjs';

export const INGREDIENT_ART_FIELDS = ['solidArtX', 'solidArtY', 'solidArtSize'];
// Eight physical parcels make one intact 4-measure ingredient.
export const INTACT_PIECE_PARTICLES = 8;

// A new handful is made of small, independent pieces. It must never extend an
// older piece (or weld a whole tower into one ever-growing ingredient sprite).
// Store the original artwork coordinates on each parcel so crushing removes
// only its own region, without stretching/recentring the surviving artwork.
export function initializeIngredientPieces(ps, solid, indices) {
  const remaining = new Set(indices);
  while (remaining.size) {
    const first = remaining.values().next().value;
    const nearby = [...remaining].filter(i => ps.materialId[i] === ps.materialId[first] &&
      Math.hypot(ps.x[i] - ps.x[first], ps.y[i] - ps.y[first]) <= .24)
      .sort((a, b) => Math.hypot(ps.x[a] - ps.x[first], ps.y[a] - ps.y[first]) -
        Math.hypot(ps.x[b] - ps.x[first], ps.y[b] - ps.y[first])).slice(0, INTACT_PIECE_PARTICLES);
    const id = solid.nextBodyId++;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const i of nearby) {
      remaining.delete(i);
      const r = effectiveParticleRadius(ps, i, true);
      minX = Math.min(minX, ps.x[i] - r); maxX = Math.max(maxX, ps.x[i] + r);
      minY = Math.min(minY, ps.y[i] - r); maxY = Math.max(maxY, ps.y[i] + r);
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const size = Math.max(.11, maxX - minX, maxY - minY);
    solid.bodyOrigins.set(id, { x: cx, y: cy, z: 0 });
    for (const i of nearby) {
      ps.solidBodyId[i] = id;
      ps.solidLocalX[i] = ps.solidArtX[i] = ps.x[i] - cx;
      ps.solidLocalY[i] = ps.solidArtY[i] = ps.y[i] - cy;
      ps.solidLocalZ[i] = 0;
      ps.solidArtSize[i] = size;
    }
  }
}

export function intactIngredientPieces(ps, ingredients) {
  const pieces = new Map();
  for (let i = 0; i < ps.count; i++) {
    if (ps.phase[i] !== Phase.SOLID || ps.frozenRadius[i] > 0 || ps.solidSubdivision[i] >= .55 ||
        ps.powderContent[i] > .001 || ps.mixtureProgress[i] > .001 || !ingredients.has(ps.materialId[i])) continue;
    const key = `${ps.materialId[i]}:${ps.solidBodyId[i] || -i - 1}`;
    if (!pieces.has(key)) pieces.set(key, { ingredient: ingredients.get(ps.materialId[i]), indices: [],
      x: ps.x[i] - ps.solidArtX[i], y: ps.y[i] - ps.solidArtY[i], size: ps.solidArtSize[i] || .11 });
    pieces.get(key).indices.push(i);
  }
  return pieces;
}
