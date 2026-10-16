import test from 'node:test';
import assert from 'node:assert/strict';
import { BrewingSession } from '../src/game/brewing.mjs';
import { PourStream, STREAM_RATE } from '../src/game/PourStream.mjs';
import { intactIngredientPieces, INGREDIENT_ART_FIELDS } from '../src/game/IngredientPieces.mjs';
import { generateWorld } from '../src/game/world.mjs';
import { sanitizeMaterial } from '../src/materials/MaterialDefinition.mjs';
import { Phase } from '../src/simulation/Phase.mjs';
import { phaseAppearance } from '../src/simulation/PhaseSolver.mjs';
import { LiquidFunFluid } from '../src/game/LiquidFunFluid.mjs';
import { liquidFunRuntime } from './helpers/liquidfun-runtime.mjs';
import { paintMaterialParticles, liquidSurfaceRadius, vapourSurfaceRadius } from '../src/game/MaterialRaster.mjs';
import { isPowder } from '../src/simulation/PowderSolver.mjs';

const runtime = liquidFunRuntime();
const water = sanitizeMaterial({ id: 1, color: '#407b9d', density: 1, thermalConductivity: .6,
  heatCapacity: .6, meltingTemperature: .2, boilingTemperature: .9, volatility: .4,
  reactionPotential: 0, combustionTemperature: 1.4 });
function create(ingredients = [{ id: 1, material: water, form: 'liquid', price: .1 }]) {
  const brew = new BrewingSession(ingredients, { cauldron: 2 });
  brew.engine.liquidFun = new LiquidFunFluid(runtime);
  return brew;
}
const step = (b, count) => { for (let n = 0; n < count; n++) b.step(); };
const color = (ps, i, out) => { out.r = ps.r[i] * 255; out.g = ps.g[i] * 255; out.b = ps.b[i] * 255; };

test('powered Frost travels from the bottom through a visible local front and finishes as one block', () => {
  const b = create();
  try {
    b.pour(1, 160, { 1: 200 }); step(b, 220); b.setThermal(0, 1); step(b, 200);
    const ps = b.engine.ps, lower = [], upper = [];
    for (let i = 0; i < ps.count; i++) (ps.y[i] < -.9 ? lower : ps.y[i] > -.55 ? upper : []).push(i);
    assert.ok(lower.length > 20 && upper.length > 20);
    const mean = (indices, field) => indices.reduce((sum, i) => sum + field(i), 0) / indices.length;
    assert.ok(mean(lower, i => ps.temperature[i]) < mean(upper, i => ps.temperature[i]) - .015);
    assert.ok(mean(lower, i => phaseAppearance(ps, i, {}).solid) > mean(upper, i => phaseAppearance(ps, i, {}).solid) + .2,
      'the cold source must frost the lower liquid first');
    assert.ok(mean(upper, i => phaseAppearance(ps, i, {}).solid) < .9, 'upper liquid has not jumped to fully frozen');
    step(b, 450);
    assert.equal(ps.phaseCounts()[Phase.SOLID], ps.count);
    assert.equal(new Set(ps.solidBodyId.subarray(0, ps.count)).size, 1);
    assert.ok(Math.abs(b.occupiedVolume - 160) < .001);
  } finally { b.dispose(); }
});

test('crushing ice removes only local frozen skin and produces independent saved powder bodies', () => {
  const b = create();
  try {
    b.pour(1, 80, { 1: 100 }); step(b, 220);
    const ps = b.engine.ps;
    for (let i = 0; i < ps.count; i++) ps.temperature[i] = .04;
    b.engine.env.ambientThermalExchange = 0; b.engine.rules.thermalDiffusionRate = 0;
    for (let n = 0; n < 100; n++) b.engine.step(.025);
    assert.equal(ps.phaseCounts()[Phase.SOLID], ps.count);
    const before = ps.totalMass(), point = { x: ps.x[0], y: ps.y[0] };
    const hit = b.crush(point);
    assert.ok(hit > 0 && hit < ps.count);
    for (let i = 0; i < ps.count; i++) {
      if (isPowder(ps, i)) {
        assert.equal(ps.frozenRadius[i], 0); assert.equal(ps.solidBodyId[i], 0);
        assert.equal(ps.powderContent[i], 1);
      } else assert.ok(ps.frozenRadius[i] > 0 && ps.solidBodyId[i] > 0);
    }
    b.engine.step(.025); b.engine.step(.025);
    assert.equal([...b.engine.liquidFun.solids.bodies.keys()].filter(id => id < 0).length, hit);
    const saved = b.snapshot(); b.restore(saved);
    assert.equal(Array.from(ps.powderContent.subarray(0, ps.count)).filter(v => v === 1).length, hit);
    assert.equal(ps.totalMass(), before);
  } finally { b.dispose(); }
});

test('repeated raw pours cannot enlarge existing artwork and swept pestle strokes remove local texture', () => {
  const world = generateWorld('bounded-artwork'), b = create(world.ingredients);
  try {
    const ingredient = world.ingredients.find(i => i.crushable), id = ingredient.id, ps = b.engine.ps;
    const raw = new Map([[id, ingredient]]);
    b.pour(id, 20, { [id]: 100 }, { point: { x: 0, y: -.5 } });
    const first = ps.count, sizes = Array.from(ps.solidArtSize.subarray(0, first));
    const ids = new Set(ps.solidBodyId.subarray(0, first));
    for (let n = 0; n < 5; n++) { step(b, 20); b.pour(id, 10, { [id]: 100 }, { point: { x: 0, y: -.5 } }); }
    for (let i = 0; i < first; i++) assert.equal(ps.solidArtSize[i], sizes[i]);
    for (let i = first; i < ps.count; i++) assert.ok(!ids.has(ps.solidBodyId[i]), 'new handfuls never extend an older body');
    for (const piece of intactIngredientPieces(ps, raw).values()) assert.ok(piece.size <= .57 && piece.indices.length <= 8);
    const survivor = [...intactIngredientPieces(ps, raw).values()].find(piece => piece.indices.length >= 4);
    const savedArt = Object.fromEntries(survivor.indices.map(i => [i, INGREDIENT_ART_FIELDS.map(field => ps[field][i])]));
    const anchor = survivor.indices[0];
    assert.ok(b.crush({ x: ps.x[anchor] + .05, y: ps.y[anchor] }, { x: ps.x[anchor] - .05, y: ps.y[anchor] }) > 0);
    for (const [index, art] of Object.entries(savedArt)) if (!isPowder(ps, +index))
      assert.deepEqual(INGREDIENT_ART_FIELDS.map(field => ps[field][+index]), art, 'untouched regions keep original texture coordinates');
    const snapshot = b.snapshot(); b.restore(snapshot);
    for (const field of INGREDIENT_ART_FIELDS) assert.deepEqual(Array.from(ps[field].subarray(0, ps.count)), snapshot.particles[field]);
    // Old saves with the former single tower body are migrated too.
    for (const field of INGREDIENT_ART_FIELDS) delete snapshot.particles[field];
    b.restore(snapshot);
    assert.ok([...intactIngredientPieces(ps, raw).values()].every(piece => piece.size <= .57));
  } finally { b.dispose(); }
});

test('held moving nozzle emits small connected parcels, pauses outside, and cannot catch up in a burst', () => {
  const b = create(), stream = new PourStream(), inventory = { 1: 100 };
  try {
    let total = 0, maxAdded = 0;
    for (let tick = 0; tick < 160; tick++) {
      const x = -.8 + tick / 160 * 1.6;
      const before = b.engine.ps.count;
      const added = stream.step(b, 1, inventory, { x, y: .65 }, .025);
      maxAdded = Math.max(maxAdded, added); total += added;
      if (added) assert.ok(Math.abs(b.engine.ps.x[before] - x) < .1, 'the live nozzle follows the finger');
      b.step();
    }
    assert.ok(Math.abs(total - STREAM_RATE * 4) <= .5);
    assert.ok(maxAdded <= .5, 'a tick emits at most one physical parcel');
    assert.ok(Math.abs(inventory[1] + total - 100) < .001);
    assert.ok(b.portions.length <= 2, 'held streams cannot grow a per-parcel history log');
    const before = b.occupiedVolume;
    for (let tick = 0; tick < 100; tick++) assert.equal(stream.step(b, 1, inventory, { x: 8, y: 8 }, .025), 0);
    assert.equal(b.occupiedVolume, before);
    const resumed = stream.step(b, 1, inventory, { x: 0, y: .65 }, .025);
    assert.ok(resumed <= .5);
    assert.ok(b.engine.ps.vy.subarray(0, b.engine.ps.count).every(v => Math.abs(v) < 5));
    stream.reset();
  } finally { b.dispose(); }
});

test('frost changes local colour/texture without holes; vapour retains liquid footprint and translucency', () => {
  const b = create(), ps = b.engine.ps;
  try {
    b.pour(1, 1, { 1: 2 }); ps.count = 1; ps.x[0] = ps.y[0] = 0; ps.nativeLiquidRadius = .055;
    const t = { w: 160, h: 120, cx: 80, cy: 60, scale: 80 };
    const paint = () => { const pixels = new Uint8ClampedArray(t.w * t.h * 4); paintMaterialParticles(ps, t, pixels, color, {}); return pixels; };
    const liquid = paint();
    ps.phaseTarget[0] = Phase.SOLID; ps.phaseProgress[0] = .5;
    const partial = paint(); ps.phaseProgress[0] = 1; const frost = paint();
    const delta = image => image.reduce((sum, v, n) => sum + (n % 4 === 3 ? 0 : Math.abs(v - liquid[n])), 0);
    assert.ok(delta(partial) > 0 && delta(frost) > delta(partial));
    const footprint = image => image.filter((v, n) => n % 4 === 3 && v > 15).length;
    assert.equal(footprint(frost), footprint(liquid));
    ps.frozenRadius[0] = ps.nativeLiquidRadius; ps.setPhase(0, Phase.SOLID);
    const handedOff = paint();
    assert.ok(handedOff.every((v, n) => Math.abs(v - frost[n]) <= 1), 'the canvas freeze handoff has no texture pop');
    ps.frozenRadius[0] = 0;
    ps.setPhase(0, Phase.GAS); const vapour = paint();
    assert.ok(vapourSurfaceRadius(ps, 0, 80) > liquidSurfaceRadius(ps, 0, 80));
    assert.ok(footprint(vapour) >= footprint(liquid));
    assert.ok(vapour[(60 * 160 + 80) * 4 + 3] > 30 && vapour[(60 * 160 + 80) * 4 + 3] < 160);
  } finally { b.dispose(); }
});


test('continuous nozzle inserts a whole smashable piece, not eight separate grains', () => {
  const world = generateWorld('whole-stream'), b = create(world.ingredients);
  const stream = new PourStream();
  try {
    const ingredient = world.ingredients.find(i => i.crushable), id = ingredient.id;
    const inventory = { [id]: 16 }, ps = b.engine.ps, point = { x: 0, y: .76 };
    assert.equal(stream.step(b, id, inventory, point, .025), 4, 'one whole on first touch');
    assert.equal(inventory[id], 12);
    assert.equal(b.occupiedVolume, 4);
    assert.equal(ps.count, 8);
    assert.equal(new Set(ps.solidBodyId.subarray(0, ps.count)).size, 1);
    assert.ok(ps.solidBodyId[0] > 0);
    assert.ok(ps.solidSubdivision.subarray(0, ps.count).every(value => value < .55));
    const raw = new Map([[id, ingredient]]);
    const pieces = intactIngredientPieces(ps, raw);
    assert.equal(pieces.size, 1, 'eight particles form one visible sprite');
    assert.equal([...pieces.values()][0].indices.length, 8);
    for (let tick = 0; tick < 8; tick++) {
      assert.equal(stream.step(b, id, inventory, point, .025), 0,
        'a held finger cannot emit ingredient fragments between whole pieces');
      b.step();
    }
    assert.equal(ps.count, 8);
    const saved = b.snapshot(); b.restore(saved);
    assert.equal(intactIngredientPieces(ps, raw).size, 1, 'saved whole artwork remains intact');
  } finally { b.dispose(); }
});

test('bulk pours create distinct coherent whole pieces, preserve stock, and crush locally', () => {
  const world = generateWorld('whole-quantity'), ingredient = world.ingredients.find(i => i.crushable);
  const id = ingredient.id, b = create(world.ingredients), ps = b.engine.ps;
  const raw = new Map([[id, ingredient]]);
  try {
    const inventory = { [id]: 100 };
    assert.equal(b.pour(id, 5, inventory, { point: { x: 0, y: .65 } }), 5);
    assert.equal(inventory[id], 95);
    assert.equal(b.occupiedVolume, 5);
    assert.equal(ps.count, 10);
    const pieces = [...intactIngredientPieces(ps, raw).values()];
    assert.equal(pieces.length, 2, 'one full piece and one smaller whole remainder');
    assert.equal(b.engine.solid.bodyOrigins.size, 2, 'whole-item pouring allocates no throwaway collider bodies');
    assert.deepEqual(pieces.map(p => p.indices.length).sort((a,b) => b-a), [8,2]);
    assert.ok(pieces.every(p => new Set(p.indices.map(i => ps.solidBodyId[i])).size === 1));
    const previousIds = new Set(ps.solidBodyId.subarray(0, ps.count));
    assert.equal(b.pour(id, 4, inventory, { point: { x: 0, y: .65 } }), 4);
    assert.equal(intactIngredientPieces(ps, raw).size, 3);
    for (let i = 10; i < ps.count; i++) assert.ok(!previousIds.has(ps.solidBodyId[i]),
      'later pours cannot weld a tower or stretch existing artwork');
    const mass = ps.totalMass(), saved = b.snapshot(); b.restore(saved);
    assert.equal(ps.totalMass(), mass);
    assert.equal(intactIngredientPieces(ps, raw).size, 3);
    const at = pieces[0].indices[0], hit = b.crush({ x: ps.x[at], y: ps.y[at] });
    assert.ok(hit > 0);
    assert.equal(ps.powderContent[at], 1, 'pestle still grinds only the touched region');
    assert.equal(ps.solidBodyId[at], 0);
    const ground = create(world.ingredients), stock = { [id]: 4 };
    try {
      assert.equal(ground.pour(id, 4, stock, { crushed: true }), 4);
      const gp = ground.engine.ps;
      assert.ok(gp.solidBodyId.subarray(0, gp.count).every(value => value === 0));
      assert.ok(gp.powderContent.subarray(0, gp.count).every(value => value === 1));
    } finally { ground.dispose(); }
  } finally { b.dispose(); }
});

test('a physically blocked whole-item nozzle does not emit loose grains or spend stock', () => {
  const world = generateWorld('whole-blocked'), ingredient = world.ingredients.find(i => i.crushable);
  const id = ingredient.id, b = create(world.ingredients), ps = b.engine.ps;
  const stream = new PourStream();
  try {
    for (let x = -.42; x <= .42; x += .07) for (let y = .34; y <= 1.12; y += .07)
      ps.add({ x, y, z: 0, mass: .5 * ingredient.material.density }, b.engine.materials.get(id), Phase.SOLID);
    const before = ps.count, stock = { [id]: 8 }, mass = ps.totalMass();
    assert.equal(stream.step(b, id, stock, { x: 0, y: .76 }, .025), 0);
    assert.equal(ps.count, before);
    assert.equal(ps.totalMass(), mass);
    assert.equal(stock[id], 8);
    assert.equal(b.portions.length, 0);
  } finally { b.dispose(); }
});
