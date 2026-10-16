// Shared original pixel silhouettes for the rack and intact matter in the pot.
// Four discrete tones make stems, cut faces and mineral facets readable without
// smoothing, image downloads, or drawing a separate icon for every physics dot.
const SHAPES = {
  leaf: [
    '...........oo...', '.........ooHBo..', '.......ooHHBBo..', '.....ooHHHBBBo..',
    '....oHHHHBBBBo..', '...oHHHHBBBSSo..', '..oHHHHoBBSSSo..', '..oHHHoBBSSSo...',
    '..oHHoBBSSSo....', '..oHoBBSSSo.....', '...oBBSSSo......', '...oBSSSo.......',
    '..oBoooo........', '.oBo............', '.oo.............', '................'
  ],
  sprig: [
    '.......oo.......', '......oHBo......', '......oBSo..ooo.', '.ooo...oo..oHBo.',
    'oHHBo..oB.oBBSo.', 'oBBSSo.oBoSSoo..', '.ooSSoooBooo....', '...oooooBo......',
    '...ooo.oBooo....', '..oHHBooBoHBo...', '..oBBSSoBoBSSo..', '...ooSSoBoSoo...',
    '.....oooBoo.....', '.......oBo......', '......oSSSo.....', '.......ooo......'
  ],
  petal: [
    '.....ooo.ooo....', '....oHHBoHHBo...', '...oHHHBoHBBBo..', '...oHHHBoBBBBo..',
    '.oooBBBBoBBBooo.', 'oHHHBBBBBBBBBBBo', 'oHHBBBBHBBBBSSSo', '.oBBBBHHHBBBSSo.',
    '..ooBBBHBBSooo..', '...oBBBBBBSSo...', '...oBBBBoBBSo...', '....oBBo.oSo....',
    '.....oo.oBo.....', '.......oBo......', '.......oo.......', '................'
  ],
  stone: [
    '................', '.....oooooo.....', '...ooHHHHBBoo...', '..oHHHHBBBBBSo..',
    '.oHHHHBBBBBSSSo.', '.oHHHBBBBBBSSSo.', 'oHHHBBBooBBBSSSo', 'oHHBBBBBoBBBSSSo',
    'oBBBBBBBBoBBSSSo', 'oBBBBBBBBooBSSSo', '.oBBBBBBBBSSSSo.', '.oBBBBBBSSSSSSo.',
    '..ooBBSSSSSSoo..', '....oooooooo....', '................', '................'
  ],
  crystal: [
    '.......o........', '......oHBo......', '.....oHHBSo.....', '.....oHHBSo.....',
    '..oo.oHHBSoooo..', '.oHBoHHHBSoHBo..', '.oHBBoHHBSoBSo..', '.oHBBoHHBSoBSo..',
    '..oBBoHHBSoBSo..', '..oBBoHBBSoBSo..', '...oBoHBBSSSo...', '...oBoBBBSSSo...',
    '....oBBBBSSo....', '.....oBBSSo.....', '......oooo......', '................'
  ],
  cap: [
    '......oooo......', '....ooHHBBoo....', '...oHHHHBBBSo...', '..oHHHBBBBBBSo..',
    '.oHHHBoHBBBBBSo.', '.oHHBBooBBBBSSo.', 'oHHBBBBBBBoBBSSo', 'oBBBBBBBBooBSSSo',
    '.oooooooooooooo.', '..oHHHHHHHSSSo..', '...ooooHSSooo...', '......oHBSo.....',
    '......oHBSo.....', '.....oHHBSoo....', '.....oBBBSSo....', '......ooooo.....'
  ],
  root: [
    '..ooo.....ooo...', '..oHBo...oHBo...', '...oHBo.oHBo....', '....oBoooBo.....',
    '.....oHBBo......', '....oHHBBSo.....', '...oHHBBSSSo....', '...oHBBSSSSo....',
    '....oBBSSSo.....', '....oBBSoo......', '...oBBBo........', '..oBSoBSo.......',
    '.oBSo.oBSo......', '.oSo...oSo......', '..o.....o.......', '................'
  ],
  bone: [
    '................', '..oo.oo.........', '.oHBoHBo........', '.oHBBBSo........',
    '..oHBBSo........', '...oHBBSo.......', '....oHBBSo......', '.....oHBBSo.....',
    '......oHBBSo....', '.......oHBBSo...', '........oHBBSo..', '.........oHBBSo.',
    '.........oHBBSo.', '..........oooo..', '................', '................'
  ]
};

export function solidIngredientArtwork(ingredient) {
  const shape = ingredient.appearance?.shape || ({ plant: 'sprig', stone: 'stone', mushroom: 'cap', root: 'root' })[ingredient.form];
  const rows = SHAPES[shape] || SHAPES.stone;
  const color = ingredient.material?.color || '#a2b67e';
  const rgb = [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16));
  const tint = (scale, lift = 0) => '#' + rgb.map(v => Math.round(Math.min(255, v * scale + lift)).toString(16).padStart(2, '0')).join('');
  return { rows, palette: { o: '#302b3f', H: tint(.75, 65), B: color, S: tint(.64) } };
}

export function paintSolidIngredient(ctx, ingredient, x, y, size) {
  const { rows, palette } = solidIngredientArtwork(ingredient);
  const pixel = size / 16;
  for (let py = 0; py < rows.length; py++) for (let px = 0; px < rows[py].length; px++) {
    const color = palette[rows[py][px]];
    if (!color) continue;
    ctx.fillStyle = color; ctx.fillRect(x + px * pixel, y + py * pixel, pixel, pixel);
  }
}
