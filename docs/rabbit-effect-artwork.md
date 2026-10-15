# Rabbit trial effect artwork

The supplied `rabbit_trials_reference_matched_assets.zip` is imported unchanged
under `public/assets/rabbit-trials/effects`. Its manifest and original README
travel with the sprites. No preview sheet is used as a game background.

The shared renderer used by colony, cards, cage and comparison selects the
approved base rabbit and four strength, transformation, acid and fire frames.
Every layer retains its 256×192 canvas, right-facing orientation and shared
(128,180) ground pivot. Mirroring, hopping and baby growth apply to the whole
composition. The existing room, controls and trials layout are retained.

## Dose stages

Artwork uses accumulated exposure, not the most recent potion concentration.
Each channel uses its existing `RABBIT_THRESHOLDS` limit. T1–T4 correspond to
the simulation's observation stages: below 25%, 25–50%, 50–75% and at least 75%
of that limit. Exposure at or below the existing .003 visual dead zone is inert.
An 8% potion therefore does **not** directly mean a particular image tier: dose
volume, repeated exposure, baby sensitivity and fire/frost cancellation still
resolve in `assessRabbitEffects` first.

## Simultaneous effects

- The greatest exposure relative to its channel threshold supplies the body.
  Ties prefer transformation, strength, acid, then fire.
- Other body effects remain visible: secondary strength broadens the body and
  adds muscle texture; transformation adds pale mutation texture; acid adds
  lesions and green corrosion; fire adds burns and temporary flame decals.
  These textures come from the supplied sprites and are clipped into the body
  core; fire-colored pixels can extend outside it while burning. Additional whole
  animals are never superimposed or silently discarded.
- Poison and love use their supplied transparent layers in that order. Frost
  and death retain their existing tint, ice and dark-aura rendering.
- Hostile rabbits retain their anger cues instead of romantic hearts. Dead
  bodies collapse, stop emitting overlays, and remain still until recovered.
- Higher fire frames contain flames in the image. They are used only while
  the simulation's fire timer is active; extinguished rabbits retain the
  flame-free singed frame with permanent scorch shading. Carbonized bodies
  remain dark and dissolved bodies retain the existing residue rendering.
- The pack's healing overlays are included and cached for future use. There is
  no healing effect in the current simulation, so they have no runtime trigger.
  Bubbles and sparkles are not introduced as game effects.

Artwork is decoded once, color variants and animated compositions use bounded
caches, and canvas rendering disables interpolation. All layers and imports
are precached for offline use under the GitHub Pages project path.
