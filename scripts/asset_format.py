"""What image format the asset pipeline writes, in one place.

Both pipelines and every validator import this, because the alternative — the
extension written out in each of the eight places that need it — is how you end
up with a pipeline that emits `.webp` and a validator that counts `.png` and
cheerfully reports zero files.

WebP at quality 85 was chosen against contact sheets, not from a table. The
measurements behind it are in `audit/webp-calibration/`; `scripts/calibrate_webp_quality.py`
regenerates them, and a different quality is one constant away rather than a
rewrite.

Two parameters are load-bearing and should not be changed casually:

`alpha_quality=100` keeps the alpha channel lossless. Verified bit-exact across
every pose and skill cell, which is what lets `validate_pose_regeneration.py` and
`validate_skill_assets.py` keep asserting that a fully transparent pixel is
exactly zero. Lossy alpha turns both of those into flaky tests.

`method=4` is libwebp's compression effort. Measured on a 360x360 pose, method 6
costs 3088 ms against method 4's 59 ms and saves 2.6%. Over 586 images that is
half an hour versus thirty-five seconds, for 230 KB — no.
"""

from __future__ import annotations

# --- Ultimate cut-in background geometry ------------------------------------
#
# Shared with the one-time converter, so the pipeline and the conversion cannot
# crop to different sizes and leave half the roster letterboxed.
#
# The cut-in draws the background centred on a 1280x720 canvas, tweened from
# scale 1.05 to a resting 1.0 (`UltimateCutIn.ts`), so at rest exactly the middle
# 1280x720 source pixels are visible — a 1:1 mapping. The only thing that reaches
# further is the glitch tween, which shifts x by +-4 px. Nothing can ever see
# more than 1288x720.
#
# The sources are 1672x941, so 40% of every one of them is margin that has never
# been on a screen. This is a crop and not a resize: at 1:1, resizing would blur
# what cropping leaves pixel-exact.
ULTIMATE_BG_SIZE = (1296, 728)

# The format the pipeline writes. 'webp' or 'png'; PNG stays reachable so a
# regression can be answered with a flag rather than an excavation.
ASSET_FORMAT = 'webp'

ASSET_QUALITY = 85

ENCODER_METHOD = 4

_SAVE_PARAMS = {
    'webp': lambda: dict(
        quality=ASSET_QUALITY, alpha_quality=100, method=ENCODER_METHOD
    ),
    'png': lambda: dict(optimize=True),
}


def suffix() -> str:
    """File extension including the dot, e.g. `.webp`."""
    return f'.{ASSET_FORMAT}'


def glob_pattern(stem: str = '*') -> str:
    """A glob for pipeline output, e.g. `*/*.webp`."""
    return f'{stem}{suffix()}'


def save_params() -> dict:
    """Keyword arguments for `PIL.Image.save`, for the configured format."""
    return _SAVE_PARAMS[ASSET_FORMAT]()


def save(image, path) -> None:
    """Write `image` to `path` in the configured format.

    `path` is taken as already carrying the right suffix; callers build it from
    `suffix()` so that the name and the encoder cannot disagree.
    """
    image.save(path, **save_params())
