# Alchemist Shop HUD

The supplied `00_full_mockup/pixel_alchemist_shop_interface.png` is the visual
reference. It is not shipped or used as a background. `public/hud.css` skins the
existing brewing DOM; the laboratory canvas, cauldron coordinates, physics,
pointer mapping, room actions, order rules, quantities and saved games are unchanged.

`public/hud/` contains 25 cleaned textures derived from the supplied
`alchemist_shop_hud_asset_pack.zip`. `src/game/hud.mjs` supplies cached icon markup.
There are no new runtime packages or additional canvases. The original pixel font
and seeded ingredient/customer artwork remain available; the pack supplies water,
Elara's portrait, tool and room icons.

| Source component | Live UI |
| --- | --- |
| Header and counter panels | Shop title, current coins and reputation |
| Customer request card | Current customer, commission, reward and dialogue |
| Brewing scene panel | Frame around the existing live laboratory |
| Ingredient cards | Generated ingredient names, current stock and selected state |
| Action and dose frames | Tool state, dose selection, thermal power and grinding |
| Pour and disabled bottle panels | Current dose, bottling and sale actions |
| Separate room icons | Garden, Trials, Potion ID, Ingredients, Recipe book |

The first five room buttons match the mockup's order. Guild and Returns are
still reachable by swiping the same navigation strip. Request requirements,
tutorial help and the sandbox inspector keep their existing behavior. Short
portrait screens compress decoration while keeping 44px primary touch targets.

To rebuild the textures, install Pillow in a development environment and run:

```sh
python scripts/prepare-hud.py /path/to/alchemist_shop_hud_asset_pack.zip
```

The preparation trims padding, replaces baked symbols/label wells with an
untouched strip of their own panel, normalizes alpha, resamples with nearest
neighbor and reduces the palette. Note that the source ingredient cards' idle
and selected filenames are visually reversed; the prepared names correct that.
Nine-slice borders preserve their corners at different screen sizes. CSS uses
`image-rendering: pixelated`; cached PNGs total less than 50 KB. The service worker
preloads the HUD stylesheet, module and textures for installed/offline use.

`npm run test:hud:browser` checks five viewport sizes, interactive states, every
room, tool behavior and loaded pixel textures. It saves reference-comparison
screenshots under `test-results/hud-*.png`. Set `SITE_URL` to run against Pages.
The existing browser, rabbit, LiquidFun and GPU fluid suites cover the complete
gameplay flows independently of the visual skin.
