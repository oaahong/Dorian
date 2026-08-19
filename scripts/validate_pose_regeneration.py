from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import argparse, hashlib, json
import asset_format
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
POSES=ROOT/'public/assets/poses'
BEFORE=ROOT/'audit/pose-regeneration-before'
# The lossless record of what the pipeline cropped, kept when the shipped assets
# became WebP. The 156-pose check below compares against this rather than against
# `POSES`, because that check is about crop geometry and lossy re-encoding makes
# a byte comparison meaningless — measured, the encoding moves a pose by up to
# 3.4 mean-absolute-difference while the weakest genuine recrop moves it by 0.63,
# so the two populations overlap and no threshold separates them.
ARCHIVE=ROOT/'asset_pipeline_backups/png-originals/poses'
ISSUES_FILE=ROOT/'audit/pose-recrop-overrides.json'
BASELINE_FILE=ROOT/'audit/passing-pose-baseline-sha256.json'
OUT=ROOT/'audit/pose-regeneration-validation'
FONT_PATH='/System/Library/Fonts/STHeiti Medium.ttc'
FONT=ImageFont.truetype(FONT_PATH,13)
FONT_SMALL=ImageFont.truetype(FONT_PATH,10)


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def longest_run(row):
    best=cur=0
    for v in row:
        cur=cur+1 if v else 0;best=max(best,cur)
    return best


def detect_lines(im):
    a=np.array(im.getchannel('A'));rgb=np.array(im.convert('RGB'))
    chroma=rgb.max(axis=2)-rgb.min(axis=2)
    bright=(a>80)&(rgb.min(axis=2)>145)&(chroma<60)
    hits=[]
    for y in range(bright.shape[0]):
        if longest_run(bright[y])>=180:hits.append(f'h:{y}')
    for x in range(bright.shape[1]):
        if longest_run(bright[:,x])>=180:hits.append(f'v:{x}')
    return hits


def rgba_check(im):
    if im.mode!='RGBA':return False,'not RGBA'
    a=np.array(im.getchannel('A'))
    if not np.any(a==0):return False,'no transparent background'
    if not np.any(a>32):return False,'empty foreground'
    return True,''


def checker(size,block=12):
    out=Image.new('RGB',size,'#555');d=ImageDraw.Draw(out)
    for y in range(0,size[1],block):
        for x in range(0,size[0],block):
            if (x//block+y//block)%2:d.rectangle((x,y,x+block-1,y+block-1),fill='#303030')
    return out


def composite(im,size=(190,190)):
    p=im.copy();p.thumbnail(size,Image.Resampling.LANCZOS)
    bg=checker(size).convert('RGBA');bg.alpha_composite(p,((size[0]-p.width)//2,(size[1]-p.height)//2))
    return bg.convert('RGB')


def contact_sheet(issues):
    cols,tw,th=5,420,250;rows=(len(issues)+cols-1)//cols
    sheet=Image.new('RGB',(cols*tw,42+rows*th),'#1e1e1e');d=ImageDraw.Draw(sheet)
    d.text((12,10),f'POSE REGENERATION — BEFORE / AFTER — {len(issues)} poses',fill='white',font=FONT)
    for i,item in enumerate(issues):
        fid=item['fighterId'];pose=str(item['pose']).zfill(2);x=(i%cols)*tw+5;y=42+(i//cols)*th+5
        bef=Image.open(BEFORE/fid/f'{pose}.png').convert('RGBA');aft=Image.open(POSES/fid/f'{pose}{asset_format.suffix()}').convert('RGBA')
        d.rectangle((x,y,x+408,y+238),outline='#666')
        d.text((x+5,y+4),f'{fid}/{pose}  {item["issueType"]}',fill='#ffe45c',font=FONT)
        d.text((x+42,y+28),'BEFORE',fill='#ff9090',font=FONT_SMALL);d.text((x+250,y+28),'AFTER',fill='#90ffae',font=FONT_SMALL)
        sheet.paste(composite(bef),(x+5,y+43));sheet.paste(composite(aft),(x+210,y+43))
    OUT.mkdir(parents=True,exist_ok=True)
    sheet.save(OUT/'before-after-156.jpg',quality=93,subsampling=0)


def all_pose_contact_sheet():
    files=sorted(POSES.glob(asset_format.glob_pattern('*/*')));cols,tw,th=10,180,205
    rows=(len(files)+cols-1)//cols
    sheet=Image.new('RGB',(cols*tw,34+rows*th),'#1e1e1e');d=ImageDraw.Draw(sheet)
    d.text((12,8),f'FULL POSE AUDIT — {len(files)} RGBA {asset_format.ASSET_FORMAT.upper()}',fill='white',font=FONT)
    for i,p in enumerate(files):
        x=(i%cols)*tw;y=34+(i//cols)*th
        d.text((x+5,y+3),f'{p.parent.name}/{p.stem}',fill='#ffe45c',font=FONT_SMALL)
        d.rectangle((x+3,y+20,x+176,y+199),outline='#555')
        im=Image.open(p).convert('RGBA');im.thumbnail((170,174),Image.Resampling.LANCZOS)
        bg=checker((170,174)).convert('RGBA');bg.alpha_composite(im,((170-im.width)//2,(174-im.height)//2))
        sheet.paste(bg.convert('RGB'),(x+5,y+23))
    sheet.save(OUT/'all-360-contact-sheet.jpg',quality=92,subsampling=0)


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--write-contact',action='store_true');args=ap.parse_args()
    issues=json.loads(ISSUES_FILE.read_text());baseline=json.loads(BASELINE_FILE.read_text())
    target={(x['fighterId'],str(x['pose']).zfill(2)) for x in issues}
    files=sorted(POSES.glob(asset_format.glob_pattern('*/*')));errors=[];warnings=[]
    if len(files)!=360:errors.append(f'expected 360 {asset_format.ASSET_FORMAT}, got {len(files)}')
    fighters={p.parent.name for p in files}
    if len(fighters)!=12:errors.append(f'expected 12 fighters, got {len(fighters)}')
    for p in files:
        im=Image.open(p);ok,msg=rgba_check(im)
        if not ok:errors.append(f'{p.parent.name}/{p.stem}: {msg}')
        lines=detect_lines(im.convert('RGBA'))
        if lines:warnings.append({'pose':f'{p.parent.name}/{p.stem}','kind':'long-line','details':lines[:12]})
    changed_passing=[]
    for key,digest in baseline.items():
        fid,pose=key.split('/')
        if sha(POSES/fid/f'{pose}{asset_format.suffix()}')!=digest:changed_passing.append(key)
    if changed_passing:errors.append(f'passing-pose regression: {changed_passing}')
    regenerated=sum(sha(ARCHIVE/fid/f'{pose}.png')!=sha(BEFORE/fid/f'{pose}.png') for fid,pose in target)
    if regenerated!=156:errors.append(f'expected 156 changed problem poses, got {regenerated}')
    result={'posesPresent':len(files),'fighters':len(fighters),'problemPosesChanged':regenerated,'passingPoseRegressions':changed_passing,'errors':errors,'warnings':warnings}
    OUT.mkdir(parents=True,exist_ok=True);(OUT/'validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    if args.write_contact:
        contact_sheet(issues)
        all_pose_contact_sheet()
    print(json.dumps(result,ensure_ascii=False,indent=2))
    raise SystemExit(1 if errors else 0)


if __name__=='__main__':main()
