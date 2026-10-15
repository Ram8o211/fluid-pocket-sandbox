// Static, shared textures from the supplied Alchemist Shop HUD pack.
// Keep these out of the canvas/particle render loop.
const names = {
  flame: 'flame', frost: 'frost', spoon: 'stir-spoon', pestle: 'pestle-mortar',
  vial: 'clean-vial', clean: 'clean-vial', coin: 'coin', star: 'reputation',
  settings: 'settings-gear', water: 'plain-water', leaf: 'garden',
  trials: 'trials', flask: 'potion-id', inventory: 'ingredients', book: 'recipe-book',
  portrait: 'customer-portrait'
};
const urls = Object.fromEntries(Object.entries(names).map(([key, name]) =>
  [key, new URL(`../../public/hud/${name}.png`, import.meta.url).href]));
const markup = Object.fromEntries(Object.entries(urls).map(([key, url]) =>
  [key, `<img class="hud-icon" src="${url}" width="40" height="40" alt="" aria-hidden="true" draggable="false">`]));

export function hudIcon(name) { return markup[name] || markup.star; }
export function hudAsset(name) { return urls[name]; }
