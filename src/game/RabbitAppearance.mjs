import { RABBIT_THRESHOLDS } from './rabbits.mjs';

// These are the simulation's four observation stages (stageText in rabbits),
// measured against each channel's own accumulated-exposure threshold.
export function rabbitEffectTier(load, threshold) {
  if (!Number.isFinite(load) || load <= .003 || !(threshold > 0)) return 0;
  return Math.min(4, 1 + Math.floor(Math.max(0, load) / threshold * 4));
}

// Ties use a stable anatomical priority, independent of dose/object key order.
const BODY_PRIORITY = ['transformation', 'strength', 'acidity', 'fire'];
const bodyAsset = effect => effect === 'acidity' ? 'acid' : effect;
export const rabbitEffectKey = (effect, tier) => `${bodyAsset(effect)}_t0${tier}`;

/** Pure rendering policy: one supplied silhouette, visible secondary anatomy
 * and damage, then transparent overlays. Never changes a dose or saved rabbit. */
export function rabbitAppearance(rabbit, now = Date.now()) {
  const exposure = rabbit.exposure || {};
  const tiers = Object.fromEntries(Object.entries(RABBIT_THRESHOLDS).map(([effect, threshold]) =>
    [effect, rabbitEffectTier(exposure[effect], threshold)]));
  const bodies = BODY_PRIORITY.filter(effect => tiers[effect]).sort((a, b) =>
    (exposure[b] || 0) / RABBIT_THRESHOLDS[b] - (exposure[a] || 0) / RABBIT_THRESHOLDS[a]);
  const body = bodies[0] || 'base', alive = rabbit.stats?.alive !== false;
  const burning = alive && tiers.fire > 0 && Number(rabbit.activeFireUntil) > now;
  const angry = rabbit.dangerous || rabbit.aggression || exposure.love >= RABBIT_THRESHOLDS.love;
  // Higher fire frames contain painted flames. Once extinguished, keep the
  // flame-free singed frame and persistent scorch shading, including on corpses.
  const bodyKey = body === 'base' ? 'effect_base' : rabbitEffectKey(body, body === 'fire' && !burning ? 1 : tiers[body]);
  const overlays = alive ? ['poison', 'love'].filter(effect => tiers[effect] && (effect !== 'love' || !angry))
    .map(effect => ({ effect, tier: tiers[effect], key: rabbitEffectKey(effect, tiers[effect]) })) : [];
  return { body, bodyKey, tiers, secondary: bodies.slice(1), overlays, burning, angry,
    scorch: Math.min(1, (exposure.fire || 0) / RABBIT_THRESHOLDS.fire) };
}

// Healing is supplied for future use, but there is no healing channel in the
// current brewing simulation. Loading its art must never invent that mechanic.
export const RABBIT_EFFECT_FILES = Object.freeze(Object.fromEntries([
  ['effect_base', 'sprites/base/base.png'],
  ...['strength', 'transformation', 'acid', 'fire'].flatMap(effect => [1, 2, 3, 4]
    .map(tier => [rabbitEffectKey(effect, tier), `sprites/${effect}/${effect}_t0${tier}.png`])),
  ...['poison', 'healing', 'love'].flatMap(effect => [1, 2, 3, 4]
    .map(tier => [rabbitEffectKey(effect, tier), `sprites/overlays/${effect}/${effect}_t0${tier}.png`]))
]));
