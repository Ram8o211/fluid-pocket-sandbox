import test from 'node:test';
import assert from 'node:assert/strict';
import { graphicsPreset, normalizeGraphicsSettings } from '../src/rendering/GraphicsSettings.mjs';

test('eco graphics uses coarse clouds and lower rendering load',()=>{const eco=graphicsPreset('ECO'),detail=graphicsPreset('DETAIL');assert.equal(eco.representation,'CLOUDS');assert.ok(eco.resolutionScale<detail.resolutionScale);assert.ok(eco.renderFraction<detail.renderFraction);assert.ok(eco.cloudCellSize>detail.cloudCellSize);});
test('manual graphics settings are clamped to safe ranges',()=>{const g=normalizeGraphicsSettings({representation:'CLOUDS',resolutionScale:.1,renderFraction:9,cloudCellSize:3,effectsScale:-2});assert.equal(g.resolutionScale,.45);assert.equal(g.renderFraction,1);assert.equal(g.cloudCellSize,1.4);assert.equal(g.effectsScale,0);});
