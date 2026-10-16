import { insideCauldron } from './cauldron.mjs';
import { clamp } from '../simulation/math.mjs';
import { INTACT_PIECE_PARTICLES } from './IngredientPieces.mjs';

// A 40 ml dose is 80 physical parcels. The old single-point emitter packed
// all 80 into a ~0.1-unit ball and then launched them downwards together:
// LiquidFun interpreted the deep overlap as a violent pressure burst.
//
// Reserve individual hexagonal positions across the *actual cauldron interior*,
// avoiding parcels already present. Placement occurs immediately (inventory,
// save/restore, mass and recipe logic stay synchronous), but starts with almost
// no injected momentum. Gravity and the existing solvers handle the descent.
const DX = .103;
const DY = .092;
const MIN_DISTANCE = .095;

// A continuous nozzle emits one parcel at a time. Keep the outlet within a
// small distance of the finger, pause against packed matter, and let gravity
// carry the stream away before emitting the next parcel.
export function findStreamOutlet(ps, point) {
  for (const [dx, dy] of [[0, 0], [0, .096], [0, .192], [-.096, .096], [.096, .096]]) {
    const x = point.x + dx, y = point.y + dy;
    if (!insideCauldron(x, y, .073)) continue;
    let free = true;
    for (let i = 0; i < ps.count; i++) {
      if ((ps.x[i] - x) ** 2 + (ps.y[i] - y) ** 2 < .087 ** 2) { free = false; break; }
    }
    if (free) return { x, y };
  }
  return null;
}
const candidates = [];
for (let row = 0, y = 1.10; y >= -1.11; row++, y -= DY) {
  for (let x = -2.29 + (row % 2) * DX / 2; x <= 2.29; x += DX) {
    if (insideCauldron(x, y, .073)) candidates.push({ x, y });
  }
}

// Place a dose near the tap, preferring nearby free space rather than punching
// through the liquid already occupying that location. Defaults favour the
// headspace; explicit touch pours can choose a point deeper in the vessel.
export function positionPouredParcels(ps, start, target = null) {
  const cx = clamp(Number.isFinite(target?.x) ? target.x : 0, -2.2, 2.2);
  const cy = clamp(Number.isFinite(target?.y) ? target.y : .76, -1.08, 1.08);
  const ordered = candidates.map((slot, index) => ({
    ...slot, index,
    rank: (slot.x - cx) ** 2 + (slot.y - cy) ** 2 * 1.12
  })).sort((a, b) => a.rank - b.rank || b.y - a.y || a.index - b.index);

  // Spatial hash keeps each new parcel's overlap check local even for a
  // full 440 ml cauldron (880 particles), without resorting to random jitter.
  const cells = new Map(), cellSize = .11;
  const coord = value => Math.floor(value / cellSize);
  const key = (x, y) => x + ':' + y;
  const insert = (x, y) => {
    const id = key(coord(x), coord(y));
    if (!cells.has(id)) cells.set(id, []);
    cells.get(id).push({ x, y });
  };
  for (let i = 0; i < start; i++) insert(ps.x[i], ps.y[i]);
  const free = (x, y, distance) => {
    const cx = coord(x), cy = coord(y), distance2 = distance * distance;
    for (let iy = cy - 1; iy <= cy + 1; iy++)
      for (let ix = cx - 1; ix <= cx + 1; ix++)
        for (const other of cells.get(key(ix, iy)) || [])
          if ((other.x - x) ** 2 + (other.y - y) ** 2 < distance2) return false;
    return true;
  };
  const used = new Set();
  let index = start;
  for (const clearance of [MIN_DISTANCE, .082, 0]) {
    for (const slot of ordered) {
      if (index >= ps.count) break;
      if (used.has(slot.index) || !free(slot.x, slot.y, clearance)) continue;
      used.add(slot.index);
      ps.x[index] = ps.px[index] = slot.x;
      ps.y[index] = ps.py[index] = slot.y;
      ps.vx[index] = 0;
      ps.vy[index] = -.12; // calm entry; real gravity accelerates the droplets
      ps.grainRest[index] = 0;
      insert(slot.x, slot.y);
      index++;
    }
    if (index >= ps.count) break;
  }
  if (index !== ps.count) throw new Error('No safe pour positions in the cauldron.');
}


// New whole ingredient items have a coherent eight-parcel footprint rather
// than isolated half-measure grains. All offsets belong to a single rigid body.
const PIECE_OFFSETS = Object.freeze([
  [0, 0], [-.098, 0], [.098, 0], [0, -.098], [0, .098],
  [-.098, -.098], [.098, -.098], [-.098, .098]
]);

/** Plan complete rigid items without mutating physics. A blocked continuous
 * outlet pauses before any ingredient is emitted; it must not teleport,
 * fragment, or violently overlap existing liquid/solids. */
export function positionWholeIngredients(ps, particleCount, point = null, continuous = false) {
  if (!particleCount) return [];
  const cx = clamp(Number.isFinite(point?.x) ? point.x : 0, -2.2, 2.2);
  const cy = clamp(Number.isFinite(point?.y) ? point.y : .76, -1.08, 1.08);
  const sorted = candidates.map((slot, index) => ({
    ...slot, index, distance: (slot.x - cx) ** 2 + (slot.y - cy) ** 2 * 1.12
  })).filter(slot => !continuous || slot.distance <= .32 ** 2)
    .sort((a, b) => a.distance - b.distance || b.y - a.y || a.index - b.index);
  const cells = new Map(), cellSize = .11;
  const coord = value => Math.floor(value / cellSize);
  const key = (x, y) => x + ':' + y;
  const insert = (x, y) => {
    const cell = key(coord(x), coord(y));
    if (!cells.has(cell)) cells.set(cell, []);
    cells.get(cell).push({ x, y });
  };
  for (let i = 0; i < ps.count; i++) insert(ps.x[i], ps.y[i]);
  const free = (x, y) => {
    const ix = coord(x), iy = coord(y);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++)
      for (const p of cells.get(key(ix + ox, iy + oy)) || [])
        if ((x - p.x) ** 2 + (y - p.y) ** 2 < .092 ** 2) return false;
    return true;
  };
  const groups = [];
  for (let start = 0; start < particleCount; start += INTACT_PIECE_PARTICLES) {
    const offsets = PIECE_OFFSETS.slice(0, Math.min(INTACT_PIECE_PARTICLES, particleCount - start));
    let chosen = null;
    for (const centre of sorted) {
      const positions = offsets.map(([dx, dy]) => ({ x: centre.x + dx, y: centre.y + dy }));
      if (!positions.every(({ x, y }) => insideCauldron(x, y, .073) && free(x, y))) continue;
      chosen = positions; break;
    }
    if (!chosen) return null;
    groups.push(chosen);
    for (const position of chosen) insert(position.x, position.y);
  }
  return groups;
}
