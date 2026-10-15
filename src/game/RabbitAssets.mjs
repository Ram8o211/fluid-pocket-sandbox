import { RABBIT_EFFECT_FILES, rabbitEffectKey } from './RabbitAppearance.mjs';

// Keep the source pack's native pixels; each decoded sprite is shared by the
// cards, comparison view and colony. Node tests retain the procedural fallback.
const files = {
  moon: '01_rabbits/rabbit_moon_card.png',
  clover: '01_rabbits/rabbit_clover_card.png',
  hazel: '01_rabbits/rabbit_hazel_card.png',
  pepper: '01_rabbits/rabbit_pepper_card.png',
  room: '05_environment/trial_room_background_empty.png',
  plaque: '02_ui_frames/caption_plaque.png',
  ...Object.fromEntries(Object.entries(RABBIT_EFFECT_FILES).map(([key, file]) => [key, `effects/${file}`]))
};
const images = new Map();
const tinted = new Map();
const fireDecals = new Map();
let loading = null, revision = 0;
export const rabbitArtworkVersion = () => revision;

export function loadRabbitArtwork() {
  if (typeof Image === 'undefined') return Promise.resolve();
  loading ||= Promise.all(Object.entries(files).map(([key, file]) => new Promise(resolve => {
    const image = new Image();
    image.onload = () => { images.set(key, image); revision++; resolve(); };
    image.onerror = () => resolve();
    image.src = new URL(`../../public/assets/rabbit-trials/${file}`, import.meta.url).href;
  })));
  return loading;
}

export function rabbitArtwork(key) { loadRabbitArtwork(); return images.get(key); }

// Original colony identities retain their names/colors. Newborn and purchased
// rabbits inherit a deterministic coat without adding anything to saved state.
export function rabbitCoat(rabbit) {
  const named = String(rabbit.name || '').toLowerCase();
  if (['moon', 'clover', 'hazel', 'pepper'].includes(named)) return named;
  const seed = Number(rabbit.mutation?.seed) || Number(String(rabbit.id || '').replace(/\D/g, '')) || 0;
  return ['moon', 'clover', 'hazel', 'pepper'][(seed >>> 0) % 4];
}

// Isolate the supplied fire pixels for simultaneous body effects. This is a
// four-entry texture cache, not a particle system or a second rabbit silhouette.
function fireDecal(tier) {
  if (fireDecals.has(tier)) return fireDecals.get(tier);
  const image = rabbitArtwork(rabbitEffectKey('fire', tier));
  if (!image) return null;
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 192;
  const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, 256, 192);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const [r, g, b] = pixels.data.subarray(i, i + 3);
    if (!(r > 155 && g > 35 && r > b * 1.8 && g > b * 1.2 && g < r * .95)) pixels.data[i + 3] = 0;
  }
  ctx.putImageData(pixels, 0, 0); fireDecals.set(tier, canvas); return canvas;
}

// Tint an alpha silhouette once per exposure stage, never the background. The
// small cache is bounded even during interpolated, multichannel dose replays.
export function rabbitSprite(rabbit, poison, frost, death, charred, appearance = null) {
  const coat = appearance?.bodyKey || rabbitCoat(rabbit), base = rabbitArtwork(coat);
  if (!base) return null;
  const cooledScorch = appearance?.body === 'fire' && !appearance.burning ? appearance.scorch : 0;
  const steps = [appearance ? 0 : poison, frost, death, cooledScorch].map(value => Math.round(value * 12));
  const secondary = appearance?.secondary || [];
  if (!charred && steps.every(value => !value) && !secondary.length) return base;
  const layers = secondary.map(effect => `${effect}:${appearance.tiers[effect]}`).join(',');
  const key = `${revision}:${coat}:${steps.join(':')}:${charred}:${layers}:${appearance?.burning}`;
  if (tinted.has(key)) return tinted.get(key);
  const canvas = document.createElement('canvas'); canvas.width = base.width; canvas.height = base.height;
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(base, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  // Lay actual supplied muscle/mutation/corrosion/burn texture into the body
  // core only. The primary silhouette and head stay legible; no duplicate eyes,
  // ears or limbs are pasted over them by another whole-animal frame.
  for (const effect of [...secondary].reverse()) {
    const tier = effect === 'fire' && !appearance.burning ? 1 : appearance.tiers[effect];
    const layer = rabbitArtwork(rabbitEffectKey(effect, tier));
    if (layer) { ctx.globalAlpha = .6 + appearance.tiers[effect] * .08; ctx.drawImage(layer, 36, 102, 136, 78, 36, 102, 136, 78); }
  }
  const colors = ['#94b46e', '#a6dce9', '#746485', '#29242f'];
  for (let i = 0; i < steps.length; i++) if (steps[i]) {
    ctx.globalAlpha = steps[i] / 12 * (i === 3 ? .8 : .5); ctx.fillStyle = colors[i]; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (charred) { ctx.globalAlpha = .88; ctx.fillStyle = '#29242f'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  if (appearance?.burning && secondary.includes('fire') && appearance.tiers.fire >= 2) {
    const fire = fireDecal(appearance.tiers.fire);
    if (fire) { ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.drawImage(fire, 0, 0); }
  }
  if (tinted.size >= 96) tinted.delete(tinted.keys().next().value);
  tinted.set(key, canvas); return canvas;
}
