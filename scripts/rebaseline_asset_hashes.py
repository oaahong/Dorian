#!/usr/bin/env python3
"""Repoint the audit baselines at the assets currently on disk.

Three files record what the pipeline produced, by content hash:

  audit/skill-assets/skill-asset-manifest.json   238 output paths, sizes, hashes
  audit/skill-assets/base-pose-sha256.json       360 pose hashes
  audit/passing-pose-baseline-sha256.json        204 pose hashes

Every one of them is invalidated the moment the encoder changes, even when not a
single pixel moves — which is exactly what happened when the pipeline stopped
writing PNG. Regenerating them by hand is 800 hashes and a chance to get one
wrong quietly, so it is a script.

Run it after a deliberate format or quality change, never to make a failing
validator go green: these baselines exist to catch art changing when it should
not, and rebaselining on reflex is how that protection gets thrown away. The
sequence is convert, look at the contact sheets, then rebaseline.

    python3 scripts/rebaseline_asset_hashes.py --dry-run
    python3 scripts/rebaseline_asset_hashes.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

import asset_format

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'audit/skill-assets/skill-asset-manifest.json'
BASE_POSES = ROOT / 'audit/skill-assets/base-pose-sha256.json'
PASSING_POSES = ROOT / 'audit/passing-pose-baseline-sha256.json'
POSES = ROOT / 'public/assets/poses'


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def retarget(output_path: str) -> str:
    """Swap a recorded path's extension for the configured one."""
    return str(Path(output_path).with_suffix(asset_format.suffix())).replace('\\', '/')


def update_manifest(dry_run: bool) -> list[str]:
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    problems: list[str] = []

    def refresh(asset: dict) -> None:
        asset['outputPath'] = retarget(asset['outputPath'])
        path = ROOT / asset['outputPath']
        if not path.exists():
            problems.append(f'missing {asset["outputPath"]}')
            return
        asset['sha256'] = sha(path)
        with Image.open(path) as image:
            asset['size'] = list(image.size)
            if 'mode' in asset:
                asset['mode'] = image.mode

    for record in manifest['fighters'].values():
        for asset in record['assets'] + record.get('derivedAssets', []):
            refresh(asset)
    for background in manifest['backgrounds'].values():
        refresh(background)

    if not dry_run and not problems:
        MANIFEST.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    return problems


def update_pose_hashes(path: Path, keyed_by_path: bool, dry_run: bool) -> list[str]:
    """Rehash a pose baseline in place, keeping whatever key style it already uses."""
    baseline = json.loads(path.read_text(encoding='utf-8'))
    problems: list[str] = []
    rebuilt: dict[str, str] = {}

    for key in baseline:
        if keyed_by_path:
            target = ROOT / retarget(key)
            new_key = retarget(key)
        else:
            fighter, pose = key.split('/')
            target = POSES / fighter / f'{pose}{asset_format.suffix()}'
            new_key = key
        if not target.exists():
            problems.append(f'missing {target.relative_to(ROOT)}')
            continue
        rebuilt[new_key] = sha(target)

    if not dry_run and not problems:
        path.write_text(
            json.dumps(rebuilt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return problems


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    problems: list[str] = []
    problems += update_manifest(args.dry_run)
    problems += update_pose_hashes(BASE_POSES, keyed_by_path=True, dry_run=args.dry_run)
    problems += update_pose_hashes(PASSING_POSES, keyed_by_path=False, dry_run=args.dry_run)

    if problems:
        for problem in problems[:20]:
            print(f'  {problem}')
        raise SystemExit(f'{len(problems)} problems; nothing written')

    verb = 'would rebaseline' if args.dry_run else 'rebaselined'
    print(f'{verb} against {asset_format.ASSET_FORMAT} q{asset_format.ASSET_QUALITY}:')
    print(f'  {MANIFEST.relative_to(ROOT)}')
    print(f'  {BASE_POSES.relative_to(ROOT)}')
    print(f'  {PASSING_POSES.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
