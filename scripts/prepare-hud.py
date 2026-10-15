"""Prepare the user-supplied HUD pack. Requires Pillow; no runtime dependency.

Usage: python scripts/prepare-hud.py /path/to/alchemist_shop_hud_asset_pack.zip
"""
from io import BytesIO
from pathlib import Path
import sys
from zipfile import ZipFile
from PIL import Image

pack = ZipFile(sys.argv[1])
output = Path('public/hud')
output.mkdir(parents=True, exist_ok=True)


def read(folder, name):
    return Image.open(BytesIO(pack.read(f'{folder}/{name}.png'))).convert('RGBA')


def trim(image):
    image.putalpha(image.getchannel('A').point(lambda value: 255 if value >= 100 else 0))
    return image.crop(image.getchannel('A').getbbox())


def blank(image, inset, column):
    """Replace baked symbols with an untouched vertical strip of the same panel."""
    width, height = image.size
    strip = image.crop((column, inset, column + 1, height - inset))
    image.paste(strip.resize((width - 2 * inset, height - 2 * inset), Image.Resampling.NEAREST), (inset, inset))
    return image


def save(image, name, size=None):
    image = trim(image)
    factor = max(image.size) / size if size else 2
    image = image.resize((round(image.width / factor), round(image.height / factor)), Image.Resampling.NEAREST)
    image = image.quantize(colors=64, method=Image.Quantize.FASTOCTREE).convert('RGBA')
    image.save(output / f'{name}.png', optimize=True)


# Keep authored corners/bevels; strip off embedded symbols, label wells and
# stray decorations so the same nine-slice works with live DOM content.
panels = [
    ('hud_top_header_bar', 'frame-wide', 16, 500),
    ('brewing_scene_panel', 'frame-scene', 16, 400),
    ('hud_coin_counter_panel', 'frame-counter', 18, 165),
    ('customer_request_card', 'frame-parchment', 24, 500),
    # The original idle/selected filenames are visually reversed in this pack.
    ('ingredient_card_selected', 'frame-card', 18, 24),
    ('ingredient_card_idle', 'frame-selected', 20, 24),
    ('action_button_flame', 'frame-tool', 15, 18),
    ('dose_button_placeholder', 'frame-dose-selected', 16, 20),
    ('button_primary_pour', 'frame-primary', 24, 255),
    ('button_secondary_bottle_disabled', 'frame-disabled', 24, 255),
]
for source, name, inset, column in panels:
    save(blank(read('02_ui_components', source), inset, column), name)

for name in ['flame', 'frost', 'stir_spoon', 'pestle_mortar', 'clean_vial', 'coin',
             'reputation', 'settings_gear', 'plain_water', 'garden', 'trials',
             'potion_id', 'ingredients', 'recipe_book', 'customer_portrait']:
    save(read('03_icons_and_labels', 'icon_' + name), name.replace('_', '-'),
         size=64 if name == 'customer_portrait' else 40)

print(f'Prepared {len(panels) + 15} individual HUD textures.')
