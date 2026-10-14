import test from 'node:test';
import assert from 'node:assert/strict';
import { trialVisuals, visualResponse } from '../src/game/TestingRenderer.mjs';
import { createExperimentState, runExperiment, resetExperimentSubject, currentExperimentReport } from '../src/game/experiments.mjs';
import { EFFECT_PROPERTIES } from '../src/game/effects.mjs';
import { drawRabbit } from '../src/game/RabbitRenderer.mjs';
import { rabbitVisualResponse } from '../src/game/RabbitPixelArt.mjs';
import { createRabbitColony, assessRabbitEffects, RABBIT_THRESHOLDS } from '../src/game/rabbits.mjs';

const sample = effects => ({ volume: 20, mass: 20, stability: 100, temperature: .33, cost: { ingredients: 1, energy: 0 },
  ...Object.fromEntries(EFFECT_PROPERTIES.map(key => [key, effects[key] || 0])) });

test('dilute responses are visible, ordered, bounded and absent for inert magic', () => {
  for (const value of [0, .002, .01, .03, .2, .6, 1, 3]) assert.ok(visualResponse(value) >= 0 && visualResponse(value) <= 1);
  assert.equal(visualResponse(0), 0); assert.equal(visualResponse(.002), 0);
  assert.ok(visualResponse(.02) > .15);
  assert.ok(visualResponse(.02) < visualResponse(.2) && visualResponse(.2) < visualResponse(.8));
});

test('all eight channels remain distinct in mixed trials, alongside an unchanged before reference', () => {
  const state = { experiments: createExperimentState(0) };
  const report = runExperiment(state, sample(Object.fromEntries(EFFECT_PROPERTIES.map(key => [key, .025]))), 'rabbit', 5, 100);
  const subject = state.experiments.subjects.rabbit, before = trialVisuals(subject, report, true), after = trialVisuals(subject, report);
  for (const key of EFFECT_PROPERTIES) { assert.equal(before[key], 0); assert.ok(after[key] > .15, `${key} needs its own visible response`); }
  assert.equal(before.alive, true); assert.equal(after.alive, report.after.alive);
  assert.ok(after.weakness > before.weakness);
});

test('dose changes visual intensity and spent subjects collapse without inventing a death enchantment', () => {
  const state = { mode: 'sandbox', experiments: createExperimentState(0) };
  const low = runExperiment(state, sample({ poison: .4 }), 'rabbit-1', 2, 100);
  const lowVisual = trialVisuals(state.experiments.rabbits[0], low);
  const high = runExperiment(state, sample({ poison: .4 }), 'rabbit-2', 10, 200);
  const highVisual = trialVisuals(state.experiments.rabbits[1], high);
  assert.ok(highVisual.poison > lowVisual.poison); assert.equal(highVisual.alive, true);
  const spent = runExperiment(state, sample({ poison: 1 }), 'rabbit-3', 3, 300);
  assert.equal(spent.after.alive, true);
  const exhausted = runExperiment(state, sample({ poison: 1 }), 'rabbit-3', 5, 7300);
  assert.equal(trialVisuals(state.experiments.rabbits[2], exhausted).alive, false);
  assert.equal(trialVisuals(state.experiments.rabbits[2], exhausted).death, 0);
});

test('new rabbits begin untreated while each original rabbit keeps its reactions and notebook records', () => {
  const state = { mode: 'sandbox', experiments: createExperimentState(0) };
  runExperiment(state, sample({ transformation: .7 }), 'rabbit-2', 5, 100);
  assert.ok(currentExperimentReport(state, 'rabbit-2'));
  const replacement = resetExperimentSubject(state, 'rabbit-2', 100);
  assert.equal(currentExperimentReport(state, replacement.id), null);
  assert.ok(currentExperimentReport(state, 'rabbit-2'));
  assert.equal(state.experiments.records.length, 1);
  const baseline = trialVisuals(replacement, null);
  assert.ok(EFFECT_PROPERTIES.every(key => baseline[key] === 0));
});

test('dilute rabbit anatomy is visible while inert magic stays absent and dose stages remain ordered', () => {
  for (const threshold of Object.values(RABBIT_THRESHOLDS)) {
    assert.equal(rabbitVisualResponse(0, threshold), 0);
    assert.equal(rabbitVisualResponse(.002, threshold), 0);
    assert.ok(rabbitVisualResponse(.025, threshold) > .15, 'a weak first dose is legible');
    const stages = [.025, .2, .8, 1.7].map(load => rabbitVisualResponse(load, threshold));
    assert.ok(stages.every((value, i) => i === 0 || value >= stages[i - 1]));
  }
});

test('procedural rabbits and every effect use integer pixels and a flat palette', () => {
  for (const effect of [null, ...EFFECT_PROPERTIES]) {
    const rabbit = createRabbitColony(1000).rabbits[0];
    if (effect) Object.assign(rabbit, assessRabbitEffects(sample({ [effect]: .2 }), rabbit, 5, 1000).afterRabbit);
    const pixels = [], scales = [];
    // No path or gradient methods exist on this context: drawing must be pixels.
    const ctx = { save() {}, restore() {}, translate() {}, scale(x, y) { scales.push([x, y]); },
      fillStyle: '', imageSmoothingEnabled: true,
      fillRect(x, y, w, h) { pixels.push([x, y, w, h, this.fillStyle]); } };
    drawRabbit(ctx, rabbit, 200, 280, 202, 200, { now: 1200 });
    assert.ok(pixels.length > 100);
    assert.ok(pixels.every(pixel => pixel.slice(0, 4).every(Number.isInteger)));
    assert.ok(pixels.every(pixel => /^#[0-9a-f]{6}$/i.test(pixel[4])), 'flat colors rather than smooth gradients');
    assert.ok(scales.every(scale => scale.every(Number.isInteger)), 'whole pixels at each rabbit size');
  }
});

test('a weak fire dose remains visible through the immediate replay without amplifying simulation exposure', () => {
  const rabbit = createRabbitColony(1000).rabbits[0];
  const report = assessRabbitEffects(sample({ fire: .025 }), rabbit, 5, 1000);
  assert.equal(report.afterRabbit.exposure.fire, .025);
  assert.ok(report.afterRabbit.activeFireUntil >= 2800);
  assert.ok(report.after.alive);
});
