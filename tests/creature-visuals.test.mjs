import test from 'node:test';
import assert from 'node:assert/strict';
import { trialVisuals, visualResponse } from '../src/game/TestingRenderer.mjs';
import { createExperimentState, runExperiment, resetExperimentSubject, currentExperimentReport } from '../src/game/experiments.mjs';
import { EFFECT_PROPERTIES } from '../src/game/effects.mjs';

const sample = effects => ({ volume: 20, mass: 20, stability: 100, temperature: .33, cost: { ingredients: 1, energy: 0 },
  ...Object.fromEntries(EFFECT_PROPERTIES.map(key => [key, effects[key] || 0])) });

test('dilute responses are visible, ordered, bounded and absent for inert magic', () => {
  for (const value of [0, .002, .01, .03, .2, .6, 1, 3]) assert.ok(visualResponse(value) >= 0 && visualResponse(value) <= 1);
  assert.equal(visualResponse(0), 0); assert.equal(visualResponse(.002), 0);
  assert.ok(visualResponse(.02) > .15);
  assert.ok(visualResponse(.02) < visualResponse(.2) && visualResponse(.2) < visualResponse(.8));
});

test('all eight channels remain distinct in mixed trials, alongside an unchanged before reference', () => {
  const state = { experiments: createExperimentState() };
  const report = runExperiment(state, sample(Object.fromEntries(EFFECT_PROPERTIES.map(key => [key, .025]))), 'rabbit', 5, 100);
  const subject = state.experiments.subjects.rabbit, before = trialVisuals(subject, report, true), after = trialVisuals(subject, report);
  for (const key of EFFECT_PROPERTIES) { assert.equal(before[key], 0); assert.ok(after[key] > .15, `${key} needs its own visible response`); }
  assert.equal(before.alive, true); assert.equal(after.alive, report.after.alive);
  assert.ok(after.weakness > before.weakness);
});

test('dose changes visual intensity and spent subjects collapse without inventing a death enchantment', () => {
  const state = { mode: 'sandbox', experiments: createExperimentState() };
  const low = runExperiment(state, sample({ poison: .4 }), 'rabbit', 2, 100);
  const lowVisual = trialVisuals(state.experiments.subjects.rabbit, low);
  resetExperimentSubject(state, 'rabbit');
  const high = runExperiment(state, sample({ poison: .4 }), 'rabbit', 10, 200);
  const highVisual = trialVisuals(state.experiments.subjects.rabbit, high);
  assert.ok(highVisual.poison > lowVisual.poison); assert.equal(highVisual.alive, true);
  resetExperimentSubject(state, 'rabbit');
  const spent = runExperiment(state, sample({ poison: 1 }), 'rabbit', 10, 300);
  assert.equal(spent.after.alive, true);
  const exhausted = runExperiment(state, sample({ poison: 1 }), 'rabbit', 5, 7300);
  assert.equal(trialVisuals(state.experiments.subjects.rabbit, exhausted).alive, false);
  assert.equal(trialVisuals(state.experiments.subjects.rabbit, exhausted).death, 0);
});

test('fresh trials clear stale reactions without deleting notebook records', () => {
  const state = { mode: 'sandbox', experiments: createExperimentState() };
  runExperiment(state, sample({ transformation: .7 }), 'beetle', 5, 100);
  assert.ok(currentExperimentReport(state, 'beetle'));
  resetExperimentSubject(state, 'beetle');
  assert.equal(currentExperimentReport(state, 'beetle'), null);
  assert.equal(state.experiments.records.length, 1);
  const baseline = trialVisuals(state.experiments.subjects.beetle, null);
  assert.ok(EFFECT_PROPERTIES.every(key => baseline[key] === 0));
});
