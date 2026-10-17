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

test('button and stream keep the same recognisable whole pieces until explicitly crushed', async () => {
  const { BrewingSession } = await import('../src/game/brewing.mjs');
  const { PourStream } = await import('../src/game/PourStream.mjs');
  const { intactIngredientPieces, isIntactIngredientParcel } = await import('../src/game/IngredientPieces.mjs');
  const world = generateWorld('same-whole-silhouette'), raw = world.ingredients.find(i => i.crushable);
  const list = new Map([[raw.id, raw]]);
  const byButton = new BrewingSession(world.ingredients), byTool = new BrewingSession(world.ingredients);
  try {
    assert.equal(byButton.pour(raw.id, 4, { [raw.id]: 4 }, { point: { x: 0, y: .75 } }), 4);
    const stream = new PourStream();
    assert.equal(stream.step(byTool, raw.id, { [raw.id]: 4 }, { x: 0, y: .75 }, .025), 4);
    for (const brew of [byButton, byTool]) {
      const ps = brew.engine.ps, pieces = [...intactIngredientPieces(ps, list).values()];
      assert.equal(pieces.length, 1, 'one rigid ingredient, not many visible grains');
      assert.equal(pieces[0].indices.length, 8);
      assert.ok(pieces[0].indices.every(i => isIntactIngredientParcel(ps, i, list)));
      assert.equal(brew.lastPour.ingredientId, raw.id, 'renderer can show the matching solid silhouette in both modes');
    }
    const ps = byTool.engine.ps, i = 0;
    assert.ok(byTool.crush({ x: ps.x[i], y: ps.y[i] }) > 0);
    assert.equal(isIntactIngredientParcel(ps, i, list), false,
      'only physically crushed regions switch back to granular rendering');
  } finally { byButton.dispose(); byTool.dispose(); }
});
