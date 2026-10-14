import { MIX_PROPERTIES } from '../reactions/MixtureSolver.mjs';
import { ParticleSystem } from '../simulation/ParticleSystem.mjs';
import { Phase } from '../simulation/Phase.mjs';
import { sanitizeMaterial } from '../materials/MaterialDefinition.mjs';
import { EFFECT_PROPERTIES, readEffects } from './effects.mjs';
import { PARTICLE_CAPACITY, PARTICLE_ML } from './cauldron.mjs';

// Portable little-endian float parcels keep a sealed vial compact. Positions
// and velocities belong to the pot; every material/thermal/magical field travels
// with the liquid. Only the live vial needs this payload, never its history.
export const POTION_PARCEL_FIELDS = Object.freeze(['mass', 'mixtureAmount', 'temperature', 'density', 'materialId',
  'phaseProgress', 'combustionProgress', 'electricPotential', 'powderContent', 'dissolutionProgress',
  'solventMeltingTemperature', 'arcaneCharge', 'arcaneConverted', 'mixtureProgress', ...MIX_PROPERTIES,
  'affinityMin', 'affinityMax']);
const STRIDE = POTION_PARCEL_FIELDS.length;
const channel = key => POTION_PARCEL_FIELDS.indexOf(key);
const effectIndices = EFFECT_PROPERTIES.map(channel);

function pack(rows, materials) {
  const bytes = new Uint8Array(rows.length * STRIDE * 4), view = new DataView(bytes.buffer);
  let offset = 0;
  for (const row of rows) for (const value of row) { view.setFloat32(offset, value, true); offset += 4; }
  let binary = '';
  for (let start = 0; start < bytes.length; start += 16384) binary += String.fromCharCode(...bytes.subarray(start, start + 16384));
  return { version: 1, count: rows.length, data: btoa(binary), materials: structuredClone(materials) };
}

function unpack(contents) {
  if (contents?.version !== 1 || !Number.isInteger(contents.count) || contents.count < 1 || contents.count > PARTICLE_CAPACITY ||
    typeof contents.data !== 'string' || contents.data.length !== Math.ceil(contents.count * STRIDE * 4 / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(contents.data) || !Array.isArray(contents.materials) || contents.materials.length > PARTICLE_CAPACITY)
    throw new Error('Invalid bottled contents.');
  const binary = atob(contents.data);
  if (binary.length !== contents.count * STRIDE * 4) throw new Error('Invalid bottled contents.');
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0)), view = new DataView(bytes.buffer), rows = [];
  for (let n = 0; n < contents.count; n++) {
    const row = Array.from({ length: STRIDE }, (_, k) => view.getFloat32((n * STRIDE + k) * 4, true));
    if (row.some(v => !Number.isFinite(v)) || row[0] <= 0 || row[1] <= 0 || row[3] <= 0 ||
      !Number.isInteger(row[4]) || row[4] < 1 || row[channel('baseDensity')] <= 0 || row[channel('heatCapacity')] <= 0 ||
      row[STRIDE - 2] < 0 || row[STRIDE - 1] > 1 || row[STRIDE - 2] > row[STRIDE - 1] ||
      effectIndices.some(k => row[k] < 0 || row[k] > 1) ||
      ['arcaneCharge', 'arcaneConverted', 'mixtureProgress', 'powderContent', 'dissolutionProgress'].some(k => row[channel(k)] < 0 || row[channel(k)] > 1))
      throw new Error('Invalid bottled material.');
    rows.push(row);
  }
  const ids = new Set();
  for (const material of contents.materials) {
    if (!material || !Number.isInteger(material.id) || material.id < 1 || ids.has(material.id) ||
      !/^#[a-f0-9]{6}$/i.test(material.color) || !(material.density > 0) || !(material.heatCapacity > 0) ||
      EFFECT_PROPERTIES.some(k => !Number.isFinite(material[k]) || material[k] < 0 || material[k] > 1))
      throw new Error('Invalid bottled source.');
    ids.add(material.id);
  }
  if (rows.some(row => !ids.has(row[4]))) throw new Error('Missing bottled source.');
  return rows;
}

export function capturePotionContents(ps, selections, mixtures, materials) {
  const ids = new Set();
  const rows = selections.map(({ index, mass }) => {
    const group = mixtures.root(ps.mixtureGroup[index]); ids.add(ps.materialId[index]);
    return POTION_PARCEL_FIELDS.map(key => key === 'mass' ? mass : key === 'mixtureAmount' ? ps.mixtureAmount[index] * mass / ps.mass[index] :
      key === 'affinityMin' ? group?.min ?? ps.miscibility[index] : key === 'affinityMax' ? group?.max ?? ps.miscibility[index] : ps[key][index]);
  });
  return pack(rows, [...ids].map(id => materials.get(id)));
}

export function scalePotionContents(contents, ratio) {
  const rows = unpack(contents);
  for (const row of rows) { row[0] *= ratio; row[1] *= ratio; }
  return pack(rows, contents.materials);
}

export function validatePotionContents(sample) {
  if (!sample?.contents) return true; // Saves made before reversible bottling.
  const rows = unpack(sample.contents);
  const mass = rows.reduce((sum, row) => sum + row[0], 0), volume = rows.reduce((sum, row) => sum + row[0] / row[3], 0);
  if (Math.abs(mass - sample.mass) > Math.max(.0002, sample.mass * .000002) || Math.abs(volume - sample.volume) > Math.max(.0002, sample.volume * .000002))
    throw new Error('Bottled quantities do not match the vial.');
  const temperature = rows.reduce((sum, row) => sum + row[0] * row[2], 0) / mass;
  if (Math.abs(temperature - sample.temperature) > .000002) throw new Error('Bottled temperature does not match the vial.');
  for (const k of effectIndices) {
    const mean = rows.reduce((sum, row) => sum + row[0] * row[k], 0) / mass;
    if (Math.abs(mean - sample[POTION_PARCEL_FIELDS[k]]) > .000002) throw new Error('Bottled magic does not match the vial.');
  }
  return true;
}

/** Archive knowledge without cloning thousands of transferable parcels. */
export function potionRecord(sample) {
  if (!sample) return sample;
  const { contents, ...record } = sample;
  return structuredClone(record);
}

function legacyContents(sample, ingredients) {
  const source = ingredients.find(i => i.id === sample.portions?.[0]?.ingredientId) || ingredients[0];
  const material = sanitizeMaterial({ ...source.material, ...sample.material, id: source.id, color: sample.color,
    density: sample.density || sample.mass / sample.volume, viscosity: sample.viscosity, volatility: sample.volatility, ...readEffects(sample) });
  const ps = new ParticleSystem(1);
  ps.add({ x: 0, y: 0, z: 0, mass: sample.mass, temperature: sample.temperature }, material, Phase.LIQUID);
  return capturePotionContents(ps, [{ index: 0, mass: sample.mass }], { root: () => null }, new Map([[material.id, material]]));
}

/** Plan first, then commit. Matching liquid parcels absorb their own returned
 * fraction, avoiding fragmentation at full capacity. Distinct states are kept
 * distinct, including awakened parcels and original affinity envelopes. */
export function restorePotionContents(engine, sample, capacity, ingredients) {
  if (!sample || !Number.isFinite(sample.volume) || sample.volume <= 0 || !Number.isFinite(sample.mass) || sample.mass <= 0 ||
    !Number.isFinite(sample.temperature) || !sample.cost || Object.values(sample.cost).some(v => !Number.isFinite(v) || v < 0)) throw new Error('No potion remains in this vial.');
  if (sample.history && Object.values(sample.history).some(v => !Number.isFinite(v) || v < 0) ||
    sample.portions && (!Array.isArray(sample.portions) || sample.portions.some(p => !p || !ingredients.some(i => i.id === p.ingredientId) || !Number.isFinite(p.ml) || p.ml < 0)))
    throw new Error('Invalid bottled preparation.');
  const contents = sample.contents || legacyContents(sample, ingredients), candidate = { ...sample, contents };
  validatePotionContents(candidate);
  const rows = unpack(contents), ps = engine.ps, mixtures = engine.reactions.mixtures;
  const amount = rows.reduce((sum, row) => sum + row[1], 0);
  let occupied = 0; for (let i = 0; i < ps.count; i++) occupied += ps.mixtureAmount[i];
  if (occupied + amount > capacity + .0002) throw new Error(`Make room in the cauldron for ${sample.volume.toFixed(1)} ml first.`);
  const keyFor = row => row.slice(2).join(',');
  const targets = new Map(), planned = new Float64Array(ps.count), massAdded = new Float64Array(ps.count), incoming = new Map();
  for (let i = 0; i < ps.count; i++) {
    if (ps.phase[i] !== Phase.LIQUID) continue;
    const group = mixtures.root(ps.mixtureGroup[i]);
    const row = POTION_PARCEL_FIELDS.map(key => key === 'affinityMin' ? group?.min ?? ps.miscibility[i] : key === 'affinityMax' ? group?.max ?? ps.miscibility[i] : ps[key][i]);
    const key = keyFor(row); if (!targets.has(key)) targets.set(key, []); targets.get(key).push(i);
  }
  for (const original of rows) {
    const row = [...original], key = keyFor(row), slots = targets.get(key);
    while (slots?.length && row[1] > .0000001) {
      const index = slots[slots.length - 1], space = Math.max(0, PARTICLE_ML - ps.mixtureAmount[index] - planned[index]);
      const returned = Math.min(space, row[1]), mass = row[0] * returned / row[1];
      planned[index] += returned; massAdded[index] += mass; row[0] -= mass; row[1] -= returned;
      if (space <= returned + .0000001) slots.pop();
    }
    if (row[1] > .0000001) {
      const previous = incoming.get(key);
      if (previous) { previous[0] += row[0]; previous[1] += row[1]; } else incoming.set(key, row);
    }
  }
  const newRows = [];
  for (const row of incoming.values()) {
    const pieces = Math.max(1, Math.ceil(row[1] / PARTICLE_ML - .000001));
    for (let n = 0; n < pieces; n++) { const piece = [...row]; piece[0] /= pieces; piece[1] /= pieces; newRows.push(piece); }
  }
  if (ps.count + newRows.length > ps.capacity) throw new Error('The cauldron needs more room before this vial can return.');
  // Nothing above this point mutates the live pot or the vial.
  for (const material of contents.materials) if (!engine.materials.has(material.id)) engine.registerMaterial(sanitizeMaterial(structuredClone(material)));
  for (let i = 0; i < planned.length; i++) { ps.mass[i] += massAdded[i]; ps.mixtureAmount[i] += planned[i]; }
  const groups = new Map();
  for (let n = 0; n < newRows.length; n++) {
    const row = newRows[n], i = ps.add({ x: Math.sin(n * 2.39996) * .9, y: .55 + n % 4 * .08, z: 0, vy: -1.3, mass: row[0], temperature: row[2] }, engine.materials.get(row[4]), Phase.LIQUID);
    for (let k = 0; k < STRIDE - 2; k++) ps[POTION_PARCEL_FIELDS[k]][i] = row[k];
    const key = `${row[STRIDE - 2]}:${row[STRIDE - 1]}`;
    let group = groups.get(key);
    if (!group) { const id = mixtures.nextId++; group = { id, parent: id, amount: 0, min: row[STRIDE - 2], max: row[STRIDE - 1], target: MIX_PROPERTIES.map(() => 0) }; mixtures.groups.set(id, group); groups.set(key, group); }
    for (let k = 0; k < MIX_PROPERTIES.length; k++) group.target[k] = (group.target[k] * group.amount + ps[MIX_PROPERTIES[k]][i] * row[1]) / (group.amount + row[1]);
    group.amount += row[1]; ps.mixtureGroup[i] = group.id;
  }
  return sample.volume;
}

export function returnVialToCauldron(state, brew) {
  if (!state.pendingBottle || state.stage === 'sale') throw new Error('No sealed potion is available to pour back.');
  const volume = brew.returnPotion(state.pendingBottle);
  state.pendingBottle = null; state.negotiation = null; state.stage = 'brewing';
  if (state.tutorial === 6) state.tutorial = 5;
  return volume;
}
