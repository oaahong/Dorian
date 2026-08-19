#!/usr/bin/env python3
"""Pick the WebP quality the asset pipeline should encode at.

The pipeline is about to stop writing PNG. That is worth roughly 77% of the
poses and 82% of the skill cells, but only if the quality holds up, and "holds
up" is not a number somebody can pick from a table — it has to be looked at.

So this writes two contact sheets and one JSON, and changes nothing:

  audit/webp-calibration/<kind>-full.jpg    each candidate at the size the game
                                            actually draws it
  audit/webp-calibration/<kind>-detail.jpg  a 4x crop, where chroma bleed on the
                                            hard edges of this art style shows up
  audit/webp-calibration/calibration.json   sizes and PSNR per candidate

Two things about the method, because both were nearly got wrong:

Poses are drawn at up to 500 px tall, not 360. `INSTALL_BODY_SCALE` is 2 and the
fighter box is 250 tall, so a transformation draws the 360 px source magnified
1.39x — any artefact is magnified with it. The full sheet therefore renders at
install scale rather than native, because native is the size at which the
encoding always looks fine.

PSNR is measured on the image composited over `COLORS.bg`, not on raw RGBA. The
RGB under a fully transparent pixel is free for the encoder to change (and it
does, to compress better), so comparing raw RGBA measures noise nobody can see
and buries the differences that matter. The reported figure is the *worst* file
in the set, never the mean: one bad pose is the whole problem, and a mean of
sixty hides it.

Usage:
    python3 scripts/calibrate_webp_quality.py
    python3 scripts/calibrate_webp_quality.py --fighters ya wizard alien
"""

import argparse
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]

# The lossless originals, not `public/assets` — those are already WebP, and
# re-encoding an encoded image measures the wrong thing. This is what the
# archive is for.
ASSETS = ROOT / 'asset_pipeline_backups' / 'png-originals'

OUT = ROOT / 'audit' / 'webp-calibration'

# COLORS.bg in src/utils/constants.ts — what every one of these is drawn onto.
BG = np.array([5, 5, 5], dtype=np.float64)

# Install draws a pose at 500 px from a 360 px source; see the module docstring.
INSTALL_SCALE = 500 / 360

# `method` is libwebp's compression effort, 0-6. Measured on a 360x360 pose:
# method 6 costs 3088 ms and saves 2.6% over method 4's 59 ms. Fifty times the
# CPU for a fortieth of the benefit is not a trade worth making here or in the
# pipeline — a full regeneration of all 586 images is 35 seconds at method 4 and
# half an hour at method 6, and the 230 KB it would buy is noise against the
# 30 MB this change is already saving.
ENCODER_METHOD = 4

CANDIDATES = [
    ('lossless', dict(lossless=True, quality=100, method=ENCODER_METHOD)),
    ('q95', dict(quality=95, alpha_quality=100, method=ENCODER_METHOD)),
    ('q90', dict(quality=90, alpha_quality=100, method=ENCODER_METHOD)),
    ('q85', dict(quality=85, alpha_quality=100, method=ENCODER_METHOD)),
]

DEFAULT_FIGHTERS = ['ya', 'wizard', 'alien']


def encode(path: Path, params: dict) -> bytes:
    buf = io.BytesIO()
    Image.open(path).save(buf, 'WEBP', **params)
    return buf.getvalue()


def composited(image: Image.Image) -> np.ndarray:
    """Flatten onto the game background, the way the screen sees it."""
    rgba = np.asarray(image.convert('RGBA'), dtype=np.float64)
    rgb, alpha = rgba[..., :3], rgba[..., 3:] / 255.0
    return rgb * alpha + BG * (1 - alpha)


def flattened(image: Image.Image) -> Image.Image:
    """Composite onto the game background and drop alpha.

    Not `convert('RGB')`, which merely discards the alpha channel and exposes
    whatever the encoder left in the RGB underneath it. Lossy WebP is free to
    rewrite those hidden values — and does, to compress better — so a sheet drawn
    with `convert` shows grey blocks over every transparent region and makes a
    perfectly good encoding look broken. The screen composites; so does this.
    """
    flat = Image.new('RGB', image.size, (5, 5, 5))
    rgba = image.convert('RGBA')
    flat.paste(rgba, (0, 0), rgba)
    return flat


def psnr(reference: np.ndarray, candidate: np.ndarray) -> float:
    mse = float(np.mean((reference - candidate) ** 2))
    return float('inf') if mse == 0 else 10 * np.log10(255 * 255 / mse)


def alpha_of(image: Image.Image) -> np.ndarray:
    return np.asarray(image.convert('RGBA'), dtype=np.uint8)[..., 3]


def font(size: int) -> ImageFont.ImageFont:
    for candidate in ('/System/Library/Fonts/Menlo.ttc', '/Library/Fonts/Arial.ttf'):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


def sheet(rows: list[tuple[str, list[Image.Image]]], headers: list[str], path: Path) -> None:
    """One row per source image, one column per candidate, labels down the side."""
    if not rows:
        return
    cell_w = max(img.width for _, images in rows for img in images)
    cell_h = max(img.height for _, images in rows for img in images)
    pad, label_w, header_h = 8, 150, 30

    width = label_w + len(headers) * (cell_w + pad) + pad
    height = header_h + len(rows) * (cell_h + pad) + pad
    canvas = Image.new('RGB', (width, height), (5, 5, 5))
    draw = ImageDraw.Draw(canvas)
    small, tiny = font(16), font(13)

    for column, header in enumerate(headers):
        draw.text((label_w + column * (cell_w + pad), 8), header, font=small, fill=(233, 185, 40))

    for row, (label, images) in enumerate(rows):
        y = header_h + row * (cell_h + pad)
        draw.text((6, y + cell_h // 2), label, font=tiny, fill=(200, 200, 200))
        for column, image in enumerate(images):
            x = label_w + column * (cell_w + pad)
            canvas.paste(flattened(image), (x, y))

    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path, quality=93, subsampling=0)


def detail_crop(image: Image.Image, zoom: int = 4) -> Image.Image:
    """The centre of the visible content, magnified with no smoothing.

    Nearest-neighbour on purpose: this sheet is for judging the encoder, and a
    smooth resample would blur away exactly the artefacts being judged.
    """
    bbox = image.convert('RGBA').getbbox() or (0, 0, image.width, image.height)
    cx, cy = (bbox[0] + bbox[2]) // 2, (bbox[1] + bbox[3]) // 2
    half = min(image.width, image.height) // 6
    box = (max(0, cx - half), max(0, cy - half),
           min(image.width, cx + half), min(image.height, cy + half))
    return image.crop(box).resize(
        ((box[2] - box[0]) * zoom, (box[3] - box[1]) * zoom), Image.NEAREST)


def scaled(image: Image.Image, factor: float) -> Image.Image:
    if factor == 1:
        return image
    return image.resize(
        (round(image.width * factor), round(image.height * factor)), Image.LANCZOS)


def calibrate(kind: str, files: list[Path], display_scale: float) -> dict:
    """Encode every file at every candidate, then report and draw the result."""
    print(f'\n=== {kind}: {len(files)} files ===')
    if not files:
        print(f'  no source images under {ASSETS / kind} — nothing to compare against')
        return {'files': 0, 'originalBytes': 0, 'candidates': {}}
    original_bytes = sum(f.stat().st_size for f in files)
    results = {}

    # Per-file PSNR at the middle candidate, so the sheets can show the files the
    # decision actually turns on rather than whichever six sort first.
    ranking: list[tuple[float, Path]] = []

    for name, params in CANDIDATES:
        total, worst_psnr, worst_file, alpha_exact = 0, float('inf'), None, True
        for f in files:
            data = encode(f, params)
            total += len(data)
            source = Image.open(f)
            decoded = Image.open(io.BytesIO(data))
            score = psnr(composited(source), composited(decoded))
            if name == 'q90':
                ranking.append((score, f))
            if score < worst_psnr:
                worst_psnr, worst_file = score, f.name
            if source.mode == 'RGBA' and not np.array_equal(alpha_of(source), alpha_of(decoded)):
                alpha_exact = False
        results[name] = {
            'bytes': total,
            'ratio': round(original_bytes / total, 2),
            'worstPsnr': None if worst_psnr == float('inf') else round(worst_psnr, 1),
            'worstFile': worst_file,
            'alphaBitExact': alpha_exact,
        }
        print(f'  {name:<10} {total/1024:8.0f} KB  {original_bytes/total:5.2f}x  '
              f'worst PSNR {worst_psnr:5.1f} dB ({worst_file})  '
              f'alpha {"exact" if alpha_exact else "LOSSY"}')

    print(f'  {"PNG (now)":<10} {original_bytes/1024:8.0f} KB')

    # The six worst files, not the first six. A contact sheet of the easy cases
    # says nothing: if the encoding is going to be rejected it will be rejected
    # on the image that compresses worst, so that is what has to be on the sheet.
    ranking.sort(key=lambda pair: pair[0])
    sample = [f for _, f in ranking[:6]]
    headers = ['PNG'] + [name for name, _ in CANDIDATES]
    full_rows, detail_rows = [], []
    for f in sample:
        variants = [Image.open(f)] + [
            Image.open(io.BytesIO(encode(f, params))) for _, params in CANDIDATES
        ]
        score = next(s for s, path in ranking if path == f)
        label = f'{f.parent.name}/{f.stem}  {score:.1f}dB'
        full_rows.append((label, [scaled(v, display_scale) for v in variants]))
        detail_rows.append((label, [detail_crop(v) for v in variants]))

    sheet(full_rows, headers, OUT / f'{kind}-full.jpg')
    sheet(detail_rows, headers, OUT / f'{kind}-detail.jpg')

    return {'files': len(files), 'originalBytes': original_bytes, 'candidates': results}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--fighters', nargs='+', default=DEFAULT_FIGHTERS)
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    report = {'fighters': args.fighters, 'kinds': {}}

    poses = [p for fid in args.fighters for p in sorted((ASSETS / 'poses' / fid).glob('*.png'))]
    report['kinds']['poses'] = calibrate('poses', poses, INSTALL_SCALE)

    skills = [p for fid in args.fighters for p in sorted((ASSETS / 'skills' / fid).glob('*.png'))]
    report['kinds']['skills'] = calibrate('skills', skills, 1.0)

    (OUT / 'calibration.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(f'\nWrote {OUT}')


if __name__ == '__main__':
    main()
