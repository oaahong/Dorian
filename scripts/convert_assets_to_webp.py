#!/usr/bin/env python3
"""One-time conversion of the already-generated PNG assets to WebP.

The pipelines now write WebP (see `asset_format.py`), but re-deriving every
image from the source sheets to get there would be the wrong move: the PNGs on
disk are the crops that were reviewed, corrected through
`audit/pose-recrop-overrides.json`, and signed off. Re-running the extractors
risks changing the art; this cannot, because PNG is lossless, so decoding one and
re-encoding it produces exactly the bytes the pipeline would now produce from the
same pixels.

The originals are moved, not deleted, to `asset_pipeline_backups/png-originals/`.
They leave `public/` so they stop being deployed — Vite copies that directory
verbatim — and stay in the tree so a change of heart about quality does not need
a pipeline run.

    python3 scripts/convert_assets_to_webp.py --dry-run
    python3 scripts/convert_assets_to_webp.py
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from PIL import Image

import asset_format

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public' / 'assets'
ARCHIVE = ROOT / 'asset_pipeline_backups' / 'png-originals'

# Directories converted as-is. The backgrounds are handled separately: they are
# the one set that gets cropped on the way through.
PLAIN = ['poses', 'skills']
BACKGROUNDS = 'ultimate-backgrounds'


def cropped_background(image: Image.Image) -> Image.Image:
    width, height = asset_format.ULTIMATE_BG_SIZE
    left = (image.width - width) // 2
    top = (image.height - height) // 2
    if left < 0 or top < 0:
        raise ValueError(f'background is {image.size}, smaller than the {width}x{height} crop')
    return image.crop((left, top, left + width, top + height))


def convert(source: Path, crop: bool, dry_run: bool) -> tuple[int, int]:
    """Returns (bytes before, bytes after)."""
    before = source.stat().st_size
    target = source.with_suffix(asset_format.suffix())

    image = Image.open(source)
    if crop:
        image = cropped_background(image)

    if dry_run:
        import io
        buffer = io.BytesIO()
        image.save(buffer, 'WEBP', **asset_format.save_params())
        return before, len(buffer.getvalue())

    asset_format.save(image, target)
    archived = ARCHIVE / source.relative_to(ASSETS)
    archived.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(archived))
    return before, target.stat().st_size


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true',
                        help='report the sizes without writing or moving anything')
    args = parser.parse_args()

    if asset_format.ASSET_FORMAT != 'webp':
        raise SystemExit(f'asset_format.ASSET_FORMAT is {asset_format.ASSET_FORMAT!r}; nothing to do')

    grand_before = grand_after = 0
    for kind in PLAIN + [BACKGROUNDS]:
        directory = ASSETS / kind
        sources = sorted(directory.rglob('*.png'))
        if not sources:
            print(f'{kind:24} nothing to convert')
            continue

        before = after = 0
        for source in sources:
            was, now = convert(source, crop=(kind == BACKGROUNDS), dry_run=args.dry_run)
            before += was
            after += now

        grand_before += before
        grand_after += after
        print(f'{kind:24} {len(sources):4} files  '
              f'{before/1024/1024:7.1f} MB -> {after/1024/1024:6.1f} MB  '
              f'{before/max(after, 1):5.1f}x')

    print(f'{"total":24} {"":4}         '
          f'{grand_before/1024/1024:7.1f} MB -> {grand_after/1024/1024:6.1f} MB  '
          f'{grand_before/max(grand_after, 1):5.1f}x')
    if args.dry_run:
        print('\n(dry run — nothing written, nothing moved)')
    else:
        print(f'\nOriginals moved to {ARCHIVE.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
