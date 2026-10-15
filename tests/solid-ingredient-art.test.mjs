import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/game/world.mjs';
import { solidIngredientArtwork } from '../src/game/SolidIngredientArt.mjs';

test('intact ingredient families have distinct bounded silhouettes in their own material colours', () => {
  const ingredients = generateWorld('raw-pixel-art').ingredients;
  const families = new Map();
  for (const ingredient of ingredients.filter(i => i.crushable)) {
    const { rows, palette } = solidIngredientArtwork(ingredient);
    assert.equal(rows.length, 16);
    assert.ok(rows.every(row => row.length === 16));
    assert.equal(palette.B, ingredient.material.color);
    assert.ok(rows.every(row => [...row].every(token => token === '.' || palette[token])));
    families.set(ingredient.appearance.shape, rows.join('\n'));
  }
  assert.equal(new Set(families.values()).size, families.size, 'leaves, petals, sprigs, roots, caps, stones, crystals and bones must be recognisable');
});
