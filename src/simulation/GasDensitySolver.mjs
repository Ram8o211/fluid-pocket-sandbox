import { Phase } from './Phase.mjs';
import { clamp } from './math.mjs';

const workspaces = new WeakMap();

/** Local vapour mass per support area/volume, separate from material density.
 * A continuous kernel avoids contact-count jumps; fractional parcels contribute
 * their actual mass. Splitting a parcel cannot invent additional concentration. */
export function updateGasDensity(ps, grid, rules, env) {
  const density = ps.localGasDensity, count = ps.count;
  density.fill(0, 0, count);
  let hasGas = false;
  let mass = workspaces.get(ps);
  if (!mass || mass.length < ps.capacity) { mass = new Float64Array(ps.capacity); workspaces.set(ps, mass); }
  for (let i = 0; i < count; i++) { mass[i] = ps.phase[i] === Phase.GAS ? ps.mass[i] : 0; hasGas ||= mass[i] > 0; }
  if (!hasGas) return;
  // Gas concentration uses its own physical support radius, independent of
  // the wider neighbour reach needed by the larger LiquidFun liquid parcels.
  const radius = .48 * clamp(rules.gasInteractionRadiusScale ?? rules.interactionRadiusScale ?? 1, .4, 1), r2 = radius * radius;
  const planar = env.dimensionMode === '2D';
  grid.forEachPair(ps, radius, (i, j) => {
    if (ps.phase[i] !== Phase.GAS || ps.phase[j] !== Phase.GAS) return;
    const dx = ps.x[j] - ps.x[i], dy = ps.y[j] - ps.y[i], dz = planar ? 0 : ps.z[j] - ps.z[i];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r2) return;
    const weight = 1 - Math.sqrt(d2) / radius;
    mass[i] += ps.mass[j] * weight; mass[j] += ps.mass[i] * weight;
  });
  const support = planar ? Math.PI * r2 : 4 * Math.PI * r2 * radius / 3;
  for (let i = 0; i < count; i++) if (ps.phase[i] === Phase.GAS) density[i] = mass[i] / support;
}
