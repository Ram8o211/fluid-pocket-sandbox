import test from 'node:test';
import assert from 'node:assert/strict';
import { EFFECT_PROPERTIES } from '../src/game/effects.mjs';
import { createRabbitColony, migrateRabbitColony, rabbitById, assessRabbitEffects,
  advanceRabbits, buyRabbit, moveRabbit, cullRabbit, RABBIT_GROWTH_MS,
  RABBIT_ATTACK_GRACE_MS, RABBIT_DEAD_LIMIT, RABBIT_EVENT_LIMIT } from '../src/game/rabbits.mjs';

const sample = effects => ({ stability: 100, color: '#ffffff',
  ...Object.fromEntries(EFFECT_PROPERTIES.map(key => [key, effects?.[key] || 0])) });
const stateAt = (now = 0) => ({ mode: 'sandbox', experiments: { records: [], serial: 0, ...createRabbitColony(now) } });
const administer = (rabbit, effects, ml = 5, now = 0) => {
  const report = assessRabbitEffects(sample(effects), rabbit, ml, now);
  Object.assign(rabbit, report.afterRabbit);
  return report;
};
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('the finite colony starts with four individual adults and purchases respect money, discount and capacity', () => {
  const state = stateAt();
  assert.equal(state.experiments.capacity, 12);
  assert.deepEqual(state.experiments.rabbits.map(rabbit => rabbit.sex), ['female', 'male', 'female', 'male']);
  assert.ok(state.experiments.rabbits.every(rabbit => rabbit.age === 'adult' && rabbit.stats.alive));
  assert.equal(rabbitById(state.experiments, 'rabbit'), state.experiments.rabbits[0]);
  for (let i = 0; i < 8; i++) buyRabbit(state, i);
  assert.equal(new Set(state.experiments.rabbits.map(rabbit => rabbit.id)).size, 12);
  assert.throws(() => buyRabbit(state, 10), /full/);
  const shop = { ...stateAt(), mode: 'shop', coins: 7, equipment: {} };
  assert.throws(() => buyRabbit(shop, 0), /8 coins/);
  assert.equal(shop.coins, 7);
  shop.equipment.densimeter = true;
  const bought = buyRabbit(shop, 0);
  assert.equal(shop.coins, 1); assert.equal(bought.age, 'adult');
});

test('strong single doses equal repeated dilute doses without clamping cumulative exposure', () => {
  const initial = createRabbitColony(0).rabbits[0];
  const weak = structuredClone(initial), strong = structuredClone(initial);
  for (let i = 0; i < 4; i++) administer(weak, { strength: .25 }, 5, i * 7000);
  administer(strong, { strength: 1 }, 5, 0);
  close(weak.exposure.strength, strong.exposure.strength);
  close(weak.stats.muscleMass, strong.stats.muscleMass);
  close(weak.stats.strength, strong.stats.strength);
  const overdose = assessRabbitEffects(sample({ strength: 1 }), initial, 20, 0);
  assert.equal(overdose.effects.strength, 1); assert.equal(overdose.doseExposure.strength, 4);
  assert.equal(overdose.afterRabbit.exposure.strength, 4);
  assert.equal(overdose.after.alive, false); assert.match(overdose.afterRabbit.causeOfDeath, /muscle/);
});

test('assessments are pure independent snapshots and cumulative muscles persist until fatal overgrowth', () => {
  const rabbit = createRabbitColony(0).rabbits[0], original = structuredClone(rabbit);
  const first = assessRabbitEffects(sample({ strength: 1 }), rabbit, 5, 100);
  assert.deepEqual(rabbit, original);
  first.after.strength = 0; first.beforeRabbit.name = 'Changed';
  assert.ok(first.afterRabbit.stats.strength > 20); assert.equal(rabbit.name, original.name);
  Object.assign(rabbit, first.afterRabbit);
  const second = administer(rabbit, { strength: 1 }, 5, 7000);
  assert.ok(second.after.muscleMass > first.afterRabbit.stats.muscleMass);
  const last = administer(rabbit, { strength: 1 }, 5, 14000);
  assert.equal(last.after.alive, false); assert.equal(last.after.muscleMass, 100);
  const dead = structuredClone(rabbit);
  administer(rabbit, {}, 5, 21000); assert.deepEqual(rabbit, dead);
});

test('acid erodes progressively into dissolution; frost extinguishes flames without undoing scorch', () => {
  const [acid, fire, tempered] = createRabbitColony(0).rabbits;
  administer(acid, { acidity: 1 }, 5, 0); close(acid.stats.corrosion, 40); close(acid.stats.health, 60);
  administer(acid, { acidity: 1 }, 5, 7000); close(acid.stats.corrosion, 80); assert.equal(acid.stats.alive, true);
  administer(acid, { acidity: 1 }, 2.5, 14000);
  assert.equal(acid.deathAppearance, 'dissolved'); assert.equal(acid.stats.alive, false);
  administer(fire, { fire: .3 }, 5, 100);
  const scorch = fire.stats.scorch; assert.ok(scorch > 0); assert.ok(fire.activeFireUntil > 100);
  administer(fire, { freeze: .3 }, 5, 8000);
  assert.equal(fire.stats.scorch, scorch); assert.ok(fire.activeFireUntil <= 8450);
  const cancelled = administer(tempered, { fire: 1, freeze: 1 }, 5, 0);
  assert.equal(tempered.exposure.fire, 0); assert.equal(tempered.exposure.freeze, 0);
  assert.equal(tempered.stats.health, 100); assert.ok(cancelled.observations.some(text => /steam/.test(text)));
  administer(fire, { fire: 1 }, 15, 15000);
  assert.equal(fire.deathAppearance, 'charred'); assert.equal(fire.stats.alive, false);
});

test('transformation evolves a stable seeded phenotype with both dangerous and fatal terminal outcomes', () => {
  const rabbits = createRabbitColony(0).rabbits;
  const creature = rabbits.find(rabbit => rabbit.mutation.outcome === 'creature');
  const malformed = rabbits.find(rabbit => rabbit.mutation.outcome === 'deformation');
  assert.ok(creature); assert.ok(malformed);
  const phenotype = structuredClone(creature.mutation);
  administer(creature, { transformation: 1 }, 5, 0);
  const firstStage = creature.stats.mutationStage;
  administer(creature, { transformation: 1 }, 5, 7000);
  assert.ok(creature.stats.mutationStage > firstStage); assert.deepEqual(creature.mutation, phenotype);
  administer(creature, { transformation: 1 }, 5, 14000);
  assert.equal(creature.transformed, true); assert.equal(creature.dangerous, true); assert.equal(creature.stats.alive, true);
  administer(malformed, { transformation: 1 }, 15, 0);
  assert.equal(malformed.stats.alive, false); assert.equal(malformed.deathAppearance, 'deformed');
});

test('aggression has a warning grace, isolation protects penmates and culling cannot resurrect a rabbit', () => {
  const state = stateAt(), aggressor = state.experiments.rabbits[0], victim = state.experiments.rabbits[1];
  const report = administer(aggressor, { love: 1 }, 15, 0);
  assert.equal(aggressor.dangerous, true); assert.ok(report.observations.some(text => /Danger/.test(text)));
  assert.equal(aggressor.attackReadyAt, RABBIT_ATTACK_GRACE_MS);
  advanceRabbits(state, RABBIT_ATTACK_GRACE_MS - 1); assert.equal(victim.stats.health, 100);
  advanceRabbits(state, RABBIT_ATTACK_GRACE_MS); assert.ok(victim.stats.health < 100);
  moveRabbit(state, aggressor.id, 'cage', 7000);
  const injuredHealth = victim.stats.health;
  advanceRabbits(state, 14000); assert.equal(victim.stats.health, injuredHealth);
  moveRabbit(state, victim.id, 'cage', 15000);
  assert.equal(aggressor.location, 'pen'); assert.equal(victim.location, 'cage');
  assert.equal(aggressor.attackReadyAt, 15000 + RABBIT_ATTACK_GRACE_MS);
  cullRabbit(state, aggressor.id, 16000); assert.equal(aggressor.stats.alive, false);
  assert.ok(state.experiments.rabbits.includes(aggressor));
  const after = structuredClone(aggressor); cullRabbit(state, aggressor.id, 17000); assert.deepEqual(aggressor, after);
  assert.throws(() => moveRabbit(state, aggressor.id, 'cage', 17000), /dead/);
});

test('love couples adults in the shared pen and babies mature but cannot tolerate a few ordinary doses', () => {
  const state = stateAt(), mother = state.experiments.rabbits[0];
  administer(mother, { love: 1 }, 5, 0);
  advanceRabbits(state, 6000);
  assert.ok(mother.courtingWith); assert.ok(mother.courtshipUntil > 6000);
  const birthAt = mother.courtshipUntil + 1;
  const events = advanceRabbits(state, birthAt);
  assert.ok(events.some(event => event.type === 'birth'));
  const baby = state.experiments.rabbits.at(-1);
  assert.equal(baby.age, 'baby'); assert.equal(baby.adultAt, birthAt + RABBIT_GROWTH_MS);
  assert.deepEqual(baby.parents, [mother.id, state.experiments.rabbits[1].id]);
  moveRabbit(state, baby.id, 'cage', birthAt);
  administer(baby, {}, 5, birthAt); assert.equal(baby.stats.alive, true);
  administer(baby, {}, 5, birthAt + 7000); assert.equal(baby.stats.alive, true);
  administer(baby, {}, 5, birthAt + 14000); assert.equal(baby.stats.alive, false);
  assert.equal(baby.causeOfDeath, 'Infant dose intolerance');
  // A later birth survives; maturation advances once without replaying offline litters.
  advanceRabbits(state, mother.nextBreedAt);
  advanceRabbits(state, mother.courtshipUntil + 1);
  const survivor = state.experiments.rabbits.at(-1);
  assert.equal(survivor.age, 'baby'); assert.equal(survivor.stats.alive, true);
  const count = state.experiments.rabbits.length;
  advanceRabbits(state, survivor.adultAt);
  assert.equal(survivor.age, 'adult'); assert.equal(survivor.stats.growth, 100);
  assert.equal(state.experiments.rabbits.length, count);
});

test('isolated rabbits and babies do not breed, and offline time never replays attacks', () => {
  const state = stateAt(), mother = state.experiments.rabbits[0];
  administer(mother, { love: 1 }, 5, 0); moveRabbit(state, mother.id, 'cage', 0);
  advanceRabbits(state, 10000); assert.equal(state.experiments.rabbits.length, 4);
  moveRabbit(state, mother.id, 'pen', 10000);
  administer(mother, { love: 1 }, 10, 10000);
  const victim = state.experiments.rabbits[1];
  advanceRabbits(state, 1000000);
  assert.equal(victim.stats.health, 100);
  assert.equal(mother.attackReadyAt, 1000000 + RABBIT_ATTACK_GRACE_MS);
  assert.equal(state.experiments.rabbits.length, 4);
});

test('separating either courting partner cancels both timers and reunion requires a new courtship', () => {
  for (const partnerIndex of [0, 1]) for (const returnByEviction of [false, true]) {
    const state = stateAt(), [mother, father, spare, otherMale] = state.experiments.rabbits;
    cullRabbit(state, otherMale.id, 0);
    administer(mother, { love: 1 }, 5, 0);
    advanceRabbits(state, 6000);
    assert.equal(mother.courtingWith, father.id);
    assert.equal(father.courtingWith, mother.id);
    const interrupted = state.experiments.rabbits[partnerIndex], oldDeadline = mother.courtshipUntil;
    moveRabbit(state, interrupted.id, 'cage', 6500);
    for (const partner of [mother, father]) {
      assert.equal(partner.courtingWith, null);
      assert.equal(partner.courtshipUntil, 0);
    }
    assert.ok(!advanceRabbits(state, oldDeadline + 1).some(event => event.type === 'birth'));
    const returnedAt = oldDeadline + 2;
    if (returnByEviction) moveRabbit(state, spare.id, 'cage', returnedAt);
    else moveRabbit(state, interrupted.id, 'pen', returnedAt);
    assert.equal(interrupted.location, 'pen');
    const reunion = advanceRabbits(state, returnedAt);
    assert.ok(reunion.some(event => event.type === 'courtship'));
    assert.ok(!reunion.some(event => event.type === 'birth'));
    assert.ok(mother.courtshipUntil > returnedAt);
    assert.equal(father.courtshipUntil, mother.courtshipUntil);
    assert.ok(advanceRabbits(state, mother.courtshipUntil + 1).some(event => event.type === 'birth'));
  }
});

test('legacy migration preserves injuries and history while current corruption remains visible to validation', () => {
  const legacy = { serial: 4, records: [{ id: 'trial-4', subjectId: 'rabbit' }], subjects: {
    rabbit: { id: 'rabbit', name: 'Old Moon', kind: 'animal', trials: 4, stats: { health: 25, vitality: 20,
      strength: 60, love: 15, transformation: 10, burning: 20, freezing: 5, alive: false } }, beetle: {} } };
  const migrated = migrateRabbitColony(legacy, 1000);
  assert.equal(migrated.rabbits.length, 4); assert.equal(migrated.rabbitSerial, 4);
  assert.equal(migrated.rabbits[0].id, 'rabbit-1'); assert.equal(migrated.rabbits[0].stats.health, 25);
  assert.equal(migrated.rabbits[0].stats.alive, false); assert.equal(migrated.rabbits[0].trials, 4);
  assert.ok(migrated.rabbits[0].exposure.strength > 0);
  assert.deepEqual(migrated.records, legacy.records); assert.deepEqual(Object.keys(migrated.subjects), ['rabbit']);
  const corrupt = { ...migrated, rabbits: structuredClone(migrated.rabbits) };
  corrupt.rabbits[0].age = null; corrupt.rabbits[0].location = 'moon'; corrupt.rabbits[0].exposure.strength = -5;
  corrupt.rabbits[0].stats.health = NaN; corrupt.rabbitSerial = -10;
  const preserved = migrateRabbitColony(corrupt, 2000);
  assert.equal(preserved.rabbits[0].age, null); assert.equal(preserved.rabbits[0].location, 'moon');
  assert.equal(preserved.rabbits[0].exposure.strength, -5); assert.ok(Number.isNaN(preserved.rabbits[0].stats.health));
  assert.equal(preserved.rabbitSerial, -10);
  const malformed = migrateRabbitColony({ ...migrated, rabbits: [null, 'bad', { ...migrated.rabbits[0], stats: null }] }, 3000);
  assert.equal(malformed.rabbits[0], null); assert.equal(malformed.rabbits[1], 'bad');
  assert.equal(malformed.rabbits[2].stats, null);
  assert.notEqual(createRabbitColony(0).rabbits[0].mutation.seed, createRabbitColony(1).rabbits[0].mutation.seed);
});

test('dead bodies and colony history stay bounded while new rabbit IDs never repeat', () => {
  const state = stateAt();
  for (let i = 0; i < 40; i++) {
    const rabbit = buyRabbit(state, i * 2);
    cullRabbit(state, rabbit.id, i * 2 + 1);
  }
  assert.equal(state.experiments.rabbits.filter(rabbit => !rabbit.stats.alive).length, RABBIT_DEAD_LIMIT);
  assert.equal(state.experiments.rabbits.filter(rabbit => rabbit.stats.alive).length, 4);
  assert.equal(state.experiments.rabbitSerial, 44);
  assert.equal(state.experiments.events.length, RABBIT_EVENT_LIMIT);
  assert.equal(new Set(state.experiments.events.map(event => event.id)).size, RABBIT_EVENT_LIMIT);
});
