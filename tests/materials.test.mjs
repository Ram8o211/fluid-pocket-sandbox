import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMaterial } from '../src/materials/MaterialGenerator.mjs';
import { weightedMaterialMean } from '../src/materials/MaterialDefinition.mjs';
import { canMix, reactionRate, visualIntensity, propertyDistance } from '../src/reactions/ReactionMath.mjs';

test('MaterialGenerator is deterministic for same seed',()=>{assert.deepEqual(generateMaterial(4242,1),generateMaterial(4242,1));assert.notDeepEqual(generateMaterial(4242,1),generateMaterial(4243,1));});
test('miscibility gate permits 0.50/0.51 and rejects 0.2/0.8',()=>{assert.equal(canMix({miscibility:.50},{miscibility:.51},.1),true);assert.equal(canMix({miscibility:.2},{miscibility:.8},.1),false);});
test('reaction rate increases as miscibility delta approaches zero',()=>{const rules={miscibilityThreshold:.2,baseMixingRate:2,mixingExponent:2};const a={miscibility:.5};const near={miscibility:.51};const far={miscibility:.65};assert.ok(reactionRate(a,near,rules,1)>reactionRate(a,far,rules,1));assert.equal(reactionRate(a,{miscibility:.8},rules,1),0);});
test('mass weighted material mean respects unequal masses',()=>{const a=generateMaterial(1,1),b=generateMaterial(2,2);a.density=.5;b.density=1.5;const m=weightedMaterialMean(a,b,1,3,3);assert.ok(Math.abs(m.density-1.25)<1e-6);});
test('visual intensity tracks property distance at high compatibility',()=>{const a=generateMaterial(3,1),b={...a,id:2,miscibility:a.miscibility+.01,density:1.6,viscosity:1,color:'#ffffff',temperature:1,reactionPotential:1};const c={...a,id:3,miscibility:a.miscibility+.01,density:a.density+.001};const rules={miscibilityThreshold:.2,reactionStrength:1};assert.ok(propertyDistance(a,b)>propertyDistance(a,c));assert.ok(visualIntensity(a,b,rules,1)>visualIntensity(a,c,rules,1));});
