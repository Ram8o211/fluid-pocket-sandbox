// Keep the source pack's native pixels; each decoded sprite is shared by the
// cards, comparison view and colony. Node tests retain the procedural fallback.
const files = {
  moon: '01_rabbits/rabbit_moon_card.png',
  clover: '01_rabbits/rabbit_clover_card.png',
  hazel: '01_rabbits/rabbit_hazel_card.png',
  pepper: '01_rabbits/rabbit_pepper_card.png',
  room: '05_environment/trial_room_background_empty.png',
  plaque: '02_ui_frames/caption_plaque.png'
};
const images = new Map();
const tinted = new Map();
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

// Tint an alpha silhouette once per exposure stage, never the background. The
// small cache is bounded even during interpolated, multichannel dose replays.
export function rabbitSprite(rabbit, poison, frost, death, charred) {
  const coat = rabbitCoat(rabbit), base = rabbitArtwork(coat);
  if (!base) return null;
  const steps = [poison, frost, death].map(value => Math.round(value * 12));
  if (!charred && steps.every(value => !value)) return base;
  const key = `${coat}:${steps.join(':')}:${charred}`;
  if (tinted.has(key)) return tinted.get(key);
  const canvas = document.createElement('canvas'); canvas.width = base.width; canvas.height = base.height;
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(base, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  const colors = ['#94b46e', '#a6dce9', '#746485'];
  for (let i = 0; i < steps.length; i++) if (steps[i]) {
    ctx.globalAlpha = steps[i] / 12 * .5; ctx.fillStyle = colors[i]; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (charred) { ctx.globalAlpha = .88; ctx.fillStyle = '#29242f'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  if (tinted.size >= 96) tinted.delete(tinted.keys().next().value);
  tinted.set(key, canvas); return canvas;
}
