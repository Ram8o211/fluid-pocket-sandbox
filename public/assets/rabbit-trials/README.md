# Rabbit Trials — Standalone Pixel-Art HUD Assets

Target game: `Ram8o211/fluid-pocket-sandbox`  
Source: user-approved generated *Rabbit Trials* reference (`00_reference/approved_rabbit_trials_mockup.png`).

## What's included

- **01_rabbits/** — transparent cutout sprites for Moon, Clover, Hazel, Pepper; Moon's comparison (before/current) variants; equal-sized card portraits. All variants exported at nearest-neighbour **4×** scale.
- **02_ui_frames/** — empty ornamental frames and panels, highlighted rabbit card, carousel, title bar, viewport overlay, labels, decorations and scrollbars.
- **03_buttons/** — text-free buttons for normal / hovered / selected / disabled / destructive / confirm state.
- **04_icons/** — individually reusable pixel-art SVG-like raster symbols as transparent **288×288 PNGs**, including potion bottles, rabbit face/skull, close X, cage, book, herbs, flowers, UI symbols.
- **05_environment/** — hand-redrawn blank alchemy trial room background (no rabbits), brick/grid/grass tiles, potion shelf, herbs, night window and shadow.
- **06_previews/** — contact sheet and comparison sprites preview.
- **07_docs/** — JSON manifest, layout coordinates and this guide.

## Rendering and integration

1. Copy `01_rabbits` through `05_environment` under `public/assets/rabbit-trials/` or your game's static asset directory.
2. Render the UI frame images behind functional HTML/Canvas components. Do **not** use the full mockup as a static UI image: labels, rabbit names, stats, dose amount, button states, controls and scroll positions stay dynamic.
3. Use `image-rendering: pixelated; image-rendering: crisp-edges;` (plus Canvas `imageSmoothingEnabled = false` where applicable). Prefer an integer display scale, especially for small icons and sprites.
4. For scalable UI frames/buttons use CSS border-image / 9-slice with values provided in `assets_manifest.json` as `nine_slice_px`. Preserve corners when changing width/height.
5. The sprite transparent PNGs use a **bottom-center anchor** (body rests on the pen floor). Draw the ground shadow beneath separately when helpful.
6. Compose `trial_room_background_empty.png` with the sprites on a foreground layer. `tile_inspection_grid_overlay.png` is optional and should be subtle.
7. Preserve all existing interactions, camera zoom and rabbit animation/state logic. Artwork is static; the game should still handle animation and effects programmatically.

## Source limitations

This pack was prepared from **a single 941×1672 raster reference** rather than original layered sprite source files. The rabbits were cut out using silhouette masks (some whiskers/outlines may need touch-ups), and UI/environment pieces were redrawn as independent, reusable pixel-art components. **Pepper was partially cropped in the reference**, so the full Pepper portrait was reconstructed from another rabbit's silhouette with spotted coloring. The exported files are high-pixel-count nearest-neighbor images; scaling does not create native subpixel detail. See `source` on each entry in the manifest. These assets are designed to be implementation-ready as a visual foundation, not a claim of pixel-perfect reconstruction from unavailable layers.

## Quality checks

- Every listed PNG exists; dimensions and alpha channels are verified.
- Frame & button assets exclude baked-in text.
- Background does not bake rabbits into the scene.
- Sourced sprites use cutout transparency rather than opaque screenshot boxes.
- Previews show the pack together for manual inspection before game implementation.

No game source files were modified or merged by creating this art pack.

## Game runtime exports

These copies use the native `base_size_px` resolution with nearest-neighbor sampling. The manifest sizes and nine-slice insets describe these runtime files. The full mockup and contact sheets are not shipped to the game.
