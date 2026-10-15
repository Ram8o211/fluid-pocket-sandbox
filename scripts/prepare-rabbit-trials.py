"""Prepare the supplied Rabbit Trials ZIP at native pixel resolution.

Usage: python scripts/prepare-rabbit-trials.py /path/to/rabbit_trials_game_ready_asset_pack.zip
Requires Pillow. The reference mockup is deliberately excluded from runtime.
"""
import io
import json
import sys
import zipfile
from pathlib import Path
from PIL import Image

target = Path(__file__).resolve().parents[1] / 'public/assets/rabbit-trials'
with zipfile.ZipFile(sys.argv[1]) as archive:
    root = 'rabbit_trials_asset_pack/'
    manifest = json.loads(archive.read(root + '07_docs/assets_manifest.json'))
    for asset in manifest['assets']:
        path = target / asset['path']
        path.parent.mkdir(parents=True, exist_ok=True)
        image = Image.open(io.BytesIO(archive.read(root + asset['path'])))
        image.resize(asset['base_size_px'], Image.Resampling.NEAREST).save(path, optimize=True)
        if 'nine_slice_px' in asset:
            asset['nine_slice_px'] = [round(value / asset['pixel_scale']) for value in asset['nine_slice_px']]
        asset['size_px'] = asset['base_size_px']
        asset['pixel_scale'] = 1
        asset['bytes'] = path.stat().st_size
    (target / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (target / 'README.md').write_text(archive.read(root + 'README.md').decode() +
        '\n## Game runtime exports\n\nThese copies use the native `base_size_px` resolution with nearest-neighbor sampling. '
        'The manifest sizes and nine-slice insets describe these runtime files. '
        'The full mockup and contact sheets are not shipped to the game.\n')
print(f"Prepared {len(manifest['assets'])} native pixel assets in {target}")
