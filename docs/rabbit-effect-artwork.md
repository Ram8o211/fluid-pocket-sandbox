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
  Surface changes shade the primary animal's own pixels through a feathered
  torso mask. Heads, eyes, ears, feet and alpha silhouettes are protected; no
  rectangular crop or pixels from another rabbit are pasted over its anatomy.
  Secondary flames use only exterior fire-colored pieces of the supplied art.
- Poison and love use their supplied transparent pieces in that order. Each
  connected wisp, droplet or heart rises, sways and fades on a staggered loop.
  Frost and death retain their tint with moving ice and dark-aura motes.
- Hostile rabbits retain their anger cues instead of romantic hearts. Dead
  bodies collapse, stop emitting overlays, and remain still until recovered.
- Higher fire frames contain flames in the image. They are used only while
  the simulation's fire timer is active; extinguished rabbits retain the
  flame-free singed frame with permanent scorch shading. Carbonized bodies
  remain dark and dissolved bodies retain the existing residue rendering.
- The pack's healing overlays are included and cached for future use. There is
  no healing effect in the current simulation, so they have no runtime trigger.
  Bubbles and sparkles are not introduced as game effects.

## Animation and alignment

Every body tier has native eye, ear and torso landmarks. A rendering-only,
seeded routine combines breathing, blinking, ear twitches, sniffing and grazing;
the colony's existing hop gait also moves the paws. Integer-pixel deformations
keep one continuous body and planted resting feet. Flames and mutation/acid
edges have a separate animated flow. Animation never advances the simulation,
administers a dose, or edits saved rabbits.

All views share the same composition and ground pivot. Visible portraits update
at approximately 10 fps; offscreen cards are skipped. Pause view freezes cards,
the pen and comparison, while Before dose remains a still historical reference.
Dead rabbits have a fixed collapsed pose and stop emitting live effects.

Artwork and connected overlay pieces are decoded once. Surface variants are
limited to 48 cached canvases and native animation frames to 128. Canvas
rendering disables interpolation. All layers and imports are precached for
offline use under the GitHub Pages project path.
