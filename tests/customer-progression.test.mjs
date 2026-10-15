import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, availableIngredients } from '../src/game/world.mjs';
import { generateOrder, simulateWitness, CUSTOMER_SCENARIOS } from '../src/game/orders.mjs';
import { assessPotion, priceSale, requirementBounds, requirementDescription, UNWANTED_EFFECT_MAX } from '../src/game/evaluation.mjs';
import { recordDelivery } from '../src/game/commerce.mjs';
import { EFFECT_PROPERTIES } from '../src/game/effects.mjs';
import { CAPACITY_ML } from '../src/game/contracts.mjs';
import { BrewingSession } from '../src/game/brewing.mjs';
import { newShop } from '../src/game/economy.mjs';
import { runExperiment } from '../src/game/experiments.mjs';
import { encodeSave, decodeSave } from '../src/game/persistence.mjs';
import { returnVialToCauldron } from '../src/game/potionTransfer.mjs';

test('early commissions require 8–15% magic and tightly cap every unwanted effect', () => {
  for (const seed of ['a', 'moonlight', 'test-guild']) {
    const world = generateWorld(seed);
    for (let completed = 0; completed < 6; completed++) {
      const equipment = {}, order = generateOrder(world, completed, equipment);
      const wanted = order.requirements.filter(r => r.comparison === 'target');
      const unwanted = order.requirements.filter(r => r.comparison === 'maximum');
      assert.ok(wanted.length, 'each commission must demand an effect');
      assert.ok(wanted.every(r => r.target >= .08 && r.target <= .15 && r.minimum >= .08), 'early desired targets and mandatory minimums start at 8%');
      assert.ok(unwanted.every(r => Math.abs(r.target + r.tolerance - UNWANTED_EFFECT_MAX) < 1e-12 && r.hard), 'unwanted limit is exactly 1.2%');
      const obtainable = availableIngredients(world, equipment).filter(i => !i.recoverOnly);
      assert.ok(order.witness.portions.every(p => obtainable.some(i => i.id === p.ingredientId) && p.ml % 5 === 0));
      assert.ok(order.witness.portions.reduce((total,p) => total+p.ml,0) <= CAPACITY_ML[0]);
      const sample = simulateWitness(world, order.witness, equipment);
      const outcome = assessPotion(sample, order);
      assert.deepEqual(outcome.hardFailures, [], 'the validated witness must not violate minimum effects or side-effect ceilings');
      assert.ok(outcome.quality >= 80, 'early witnesses must work in the real cauldron');
    }
  }
});

test('later commissions increase wanted effect thresholds without easing unwanted limits', () => {
  const world = generateWorld('progression-check');
  for (const completed of [6, 8, 12, 14]) {
    const equipment = {cauldron:2, reagents:3, furnace:1};
    const order = generateOrder(world, completed, equipment);
    assert.ok(order.requirements.some(r => r.comparison === 'target' && r.target > .15));
    assert.ok(order.requirements.filter(r => r.comparison === 'maximum').every(r => Math.abs(r.target + r.tolerance - .012) < 1e-12));
    assert.ok(order.witness.portions.every(p => p.ml % 5 === 0));
    const sample = simulateWitness(world, order.witness, equipment);
    const result = assessPotion(sample, order);
    assert.equal(result.hardFailures.length, 0, 'the high-level target remains achievable');
    assert.ok(result.quality >= 80, 'powerful commissions have a simulated witness');
  }
});

test('combined stories describe one coherent scenario instead of splicing unrelated purposes', () => {
  const world = generateWorld('story-coherence');
  const examples = new Set();
  for (let i = 0; i < 12; i++) {
    const order = generateOrder(world, i, {cauldron:2, reagents:3});
    const wanted = order.requirements.filter(r => r.comparison === 'target').map(r => r.property);
    assert.deepEqual(order.scenarioKey.split('+').sort(), wanted.slice().sort(), 'every requested effect belongs to the selected scenario');
    assert.ok(CUSTOMER_SCENARIOS[order.scenarioKey].some(story => order.customer.dialogue.startsWith(story)));
    examples.add(order.customer.dialogue);
    assert.doesNotMatch(order.customer.dialogue,/and build strength for|and keep my lantern burning| and bring frost to the summer storeroom/);
    assert.ok(!wanted.includes('fire') || !wanted.includes('freeze'), 'fire and frost cannot be paired without a coherent use');
  }
  assert.ok(examples.size >= 8, 'many scenarios must be generated');
});

const contract = {
  id: 'boundary-order', volume: 80, budget: 80, customer: { name: 'Mira' }, requirements: [
    { property:'strength', target:.1, tolerance:.02, minimum:.08, weight:3, hard:false, comparison:'target' },
    ...EFFECT_PROPERTIES.filter(key => key !== 'strength').map(property => ({
      property, target:.009, tolerance:.003, weight:.4, hard:true, comparison:'maximum'
    }))
  ]
};
const vial = {
  batchId:'boundary-batch', volume:80, mass:80, liquidFraction:1, color:'#88aacc', temperature:.33,
  cost:{ingredients:1,energy:0}, ...Object.fromEntries(EFFECT_PROPERTIES.map(key => [key,0])), strength:.1
};
const delivery = (sample, order = contract) => recordDelivery({ seed:'boundary', completed:0 }, { payment:40 }, sample, order, 0);

test('1.2% is an inclusive hard boundary in assessment, pricing, display and returns for every unwanted channel', () => {
  for (const requirement of contract.requirements.filter(r => r.comparison === 'maximum')) {
    assert.equal(requirementBounds(requirement).maximum, UNWANTED_EFFECT_MAX);
    assert.equal(requirementDescription(requirement), 'At most 1.2%');
    for (const value of [0,.009,.0119999,.012]) {
      const sample = { ...vial, [requirement.property]:value };
      assert.equal(assessPotion(sample,contract).acceptable,true,`${requirement.property} at ${value}`);
      assert.ok(priceSale(sample,contract).payment > 0);
      assert.equal(delivery(sample).genuine,false);
    }
    for (const value of [.0120001,.013,.02,NaN,Infinity]) {
      const sample = { ...vial, [requirement.property]:value };
      assert.equal(assessPotion(sample,contract).acceptable,false);
      assert.equal(priceSale(sample,contract).payment,0);
      assert.ok(assessPotion(sample,contract).hardFailures.includes(requirement.property));
      if (Number.isFinite(value)) {
        const receipt = delivery(sample);
        assert.equal(receipt.genuine,true); assert.ok(receipt.sideEffects.includes(requirement.property));
      }
    }
  }
});

test('mandatory wanted minimums cannot be bypassed by tolerance, pricing or the complaint assessment', () => {
  const order = structuredClone(contract), requirement = order.requirements[0];
  requirement.target = .09; // The mandatory 8% floor overrides the 7% tolerance edge.
  assert.deepEqual(requirementBounds(requirement),{minimum:.08,maximum:.11});
  assert.equal(requirementDescription(requirement),'8.0–11.0% · aim 9.0%');
  for (const strength of [0,.07,.0799999,NaN]) {
    const sample = { ...vial, strength }, result = assessPotion(sample,order);
    assert.equal(result.acceptable,false); assert.equal(result.breakdown[0].met,false);
    assert.equal(priceSale(sample,order).payment,0);
    if (Number.isFinite(strength)) assert.equal(delivery(sample,order).genuine,true);
  }
  assert.equal(assessPotion({...vial,strength:.08},order).acceptable,true);
  assert.equal(delivery({...vial,strength:.08},order).genuine,false);
});

test('reference validation rejects locked ingredients, recovery-only stock and silently truncated capacity', () => {
  const world = generateWorld('witness-inputs');
  assert.throws(() => simulateWitness(world,{portions:[{ingredientId:7,ml:10}],volume:5,ticks:0}),/locked/);
  assert.throws(() => simulateWitness(world,{portions:[{ingredientId:1,ml:205}],volume:60,ticks:0}),/full portion/);
  const recovered = structuredClone(world.ingredients.find(i => i.id === 14)); recovered.recoverOnly = true;
  world.ingredients = world.ingredients.map(i => i.id === 14 ? recovered : i);
  assert.throws(() => simulateWitness(world,{portions:[{ingredientId:14,ml:10}],volume:5,ticks:0}),/recovery-only/);
});

test('repeated actual brewing is deterministic and cached orders cannot be mutated by a save', () => {
  const world = generateWorld('foundation-repeat'), before = structuredClone(world);
  const order = generateOrder(world), original = structuredClone(order);
  const first = simulateWitness(world,order.witness), second = simulateWitness(world,order.witness);
  for (const key of ['volume','mass','temperature','color','composition','history','cost',...EFFECT_PROPERTIES])
    assert.deepEqual(first[key],second[key],key);
  for (const r of order.requirements) assert.equal(order.targetDescriptions[r.property],requirementDescription(r));
  order.witness.portions[0].ml = 10000; order.requirements[0].minimum = 0;
  assert.deepEqual(generateOrder(world),original);
  assert.deepEqual(world,before);
  for (const ingredient of world.ingredients) {
    assert.ok(!original.clue.includes(ingredient.name)); assert.ok(!original.customer.dialogue.includes(ingredient.name));
  }
});

test('an awakened customer brew conserves stock, matter and magic across trials, bottling, reload and pouring back', () => {
  const state = newShop(generateWorld('foundation-handoff')), stock = structuredClone(state.inventory);
  const brew = new BrewingSession(state.world.ingredients,state.equipment), recipe = state.order.witness;
  let restored;
  const close = (a,b,label) => assert.ok(Math.abs(a-b)<1e-5,`${label}: ${a} versus ${b}`);
  try {
    for (const portion of recipe.portions) {
      assert.equal(brew.pour(portion.ingredientId,portion.ml,state.inventory,{crushed:Boolean(portion.crushed)}),portion.ml);
      assert.equal(state.inventory[portion.ingredientId],stock[portion.ingredientId]-portion.ml);
    }
    const originalMass = brew.engine.ps.totalMass();
    for (let tick=0;tick<recipe.ticks;tick++) {
      brew.setThermal(tick<recipe.thermalTicks?recipe.heat:0,tick<recipe.thermalTicks?recipe.cool:0);
      if (recipe.stir && tick>20) brew.assistStir();
      brew.step();
    }
    close(brew.engine.ps.totalMass(),originalMass,'brewing mass');
    const before = brew.inspect(), inventory = structuredClone(state.inventory), dose = brew.takeSample(5);
    runExperiment(state,dose,'rabbit-2',dose.volume);
    state.pendingBottle = brew.bottle(state.order.volume); state.stage='inspection';
    assert.equal(assessPotion(state.pendingBottle,state.order).quality,100);
    const saved = decodeSave(encodeSave(state,brew));
    assert.deepEqual(saved.order,state.order); assert.deepEqual(saved.pendingBottle,state.pendingBottle);
    restored = new BrewingSession(saved.world.ingredients,saved.equipment); restored.restore(saved.brew);
    const remaining = restored.inspect(), bottle = saved.pendingBottle;
    close(remaining.mass+bottle.mass+dose.mass,before.mass,'sampled mass');
    close(remaining.volume+bottle.volume+dose.volume,before.volume,'sampled quantity');
    for (const key of EFFECT_PROPERTIES)
      close(remaining[key]*remaining.mass+bottle[key]*bottle.mass+dose[key]*dose.mass,before[key]*before.mass,`sampled ${key}`);
    close(returnVialToCauldron(saved,restored),bottle.volume,'returned quantity');
    assert.equal(saved.pendingBottle,null); assert.deepEqual(saved.inventory,inventory);
    const returned = restored.inspect();
    close(returned.mass+dose.mass,before.mass,'returned mass');
    close(returned.volume+dose.volume,before.volume,'returned potion quantity');
    for (const key of EFFECT_PROPERTIES)
      close(returned[key]*returned.mass+dose[key]*dose.mass,before[key]*before.mass,`returned ${key}`);
    const again = decodeSave(encodeSave(saved,restored));
    assert.deepEqual(again.brew.particles,restored.snapshot().particles,'reload retains awakened parcel state');
  } finally { brew.dispose(); restored?.dispose(); }
});
