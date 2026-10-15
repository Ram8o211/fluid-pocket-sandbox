# Rabbit Trials reference-matched asset pack

This pack replaces the earlier asset pack that accidentally introduced deer-like, fox-like and horned transformation creatures. This pack follows the user-approved five-body Rabbit Trials matrix and excludes the nonexistent Bubbles/Sparkles game effects.

- `sprites/base/base.png`: unchanged rabbit.
- `sprites/{strength,transformation,acid,fire}/*`: whole-rabbit replacement sprites for T1–T4.
- `sprites/overlays/{poison,healing,love}/*`: transparent effects, T1–T4.
- `previews/01_combination_matrix.png`: actual T4 body + T3 overlay composites, 5x4 matrix.
- `previews/02_magnitude_tiers.png`: 0–4 progression, matching the intended archetype.
- `previews/03_overlay_magnitude_tiers.png`: overlay progression.
- `metadata/manifest.json`: explicit composition rules and references.

All exported PNGs are RGBA, 256x192, right-facing, anchored to baseline y=180. Use nearest-neighbor scaling and the same pivot for body/overlays. The runtime must map actual effect potency to tiers. Whole-body combinations (e.g. strength + acid) require gameplay-dependent layering rules or additional combination-specific sprites, not silent override.

**Quality boundary:** The approved T4 and base animals are extracted directly from the approved supplied illustration. The lower tiers are visual approximations created from a matching generated sheet. Transparent mask edges may need some manual pixel cleanup; these are static frames and don't provide walking/death pose animations.
