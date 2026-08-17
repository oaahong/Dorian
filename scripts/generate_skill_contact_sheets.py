#!/usr/bin/env python3
from pathlib import Path
import json,math
from PIL import Image,ImageOps,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[1]
M=json.loads((ROOT/'audit/skill-assets/skill-asset-manifest.json').read_text())
OUT=ROOT/'audit/skill-assets/contact_sheets';OUT.mkdir(parents=True,exist_ok=True)
font=ImageFont.load_default()

def checker(size):
 im=Image.new('RGB',size,(45,45,45));d=ImageDraw.Draw(im);s=16
 for y in range(0,size[1],s):
  for x in range(0,size[0],s):
   if (x//s+y//s)%2:d.rectangle((x,y,x+s-1,y+s-1),fill=(70,70,70))
 return im

def fit_rgba(path,size=(180,150)):
 src=Image.open(path).convert('RGBA');src.thumbnail((size[0]-12,size[1]-28),Image.Resampling.LANCZOS)
 bg=checker(size).convert('RGBA');x=(size[0]-src.width)//2;y=max(2,(size[1]-24-src.height)//2);bg.alpha_composite(src,(x,y));return bg.convert('RGB')

def sheet_for(fid,assets):
 cell=(190,180);cols=5;rows=math.ceil(len(assets)/cols);canvas=Image.new('RGB',(cell[0]*cols,cell[1]*rows),(24,24,24));d=ImageDraw.Draw(canvas)
 for i,a in enumerate(assets):
  x=(i%cols)*cell[0];y=(i//cols)*cell[1];tile=fit_rgba(ROOT/a['outputPath'],(180,150));canvas.paste(tile,(x+5,y+5));d.text((x+8,y+158),f"{fid} {a['poseId']} {a['category'][:10]}",font=font,fill='white')
 canvas.save(OUT/f'{fid}.jpg',quality=91)
 return canvas
all_assets=[]
for fid,rec in M['fighters'].items():
 items=rec['assets']+rec.get('derivedAssets',[]);sheet_for(fid,items);all_assets.extend([(fid,a) for a in items])
cell=(160,150);cols=8;rows=math.ceil(len(all_assets)/cols);canvas=Image.new('RGB',(cell[0]*cols,cell[1]*rows),(20,20,20));d=ImageDraw.Draw(canvas)
for i,(fid,a) in enumerate(all_assets):
 x=(i%cols)*cell[0];y=(i//cols)*cell[1];tile=fit_rgba(ROOT/a['outputPath'],(150,122));canvas.paste(tile,(x+5,y+5));d.text((x+6,y+130),f'{fid}:{a["poseId"]}',font=font,fill='white')
canvas.save(OUT/'all_generated_assets_contact_sheet.jpg',quality=90)
# Before/after: original full sheet next to generated sheet thumbnail for each fighter.
rows=[]
for fid,rec in M['fighters'].items():
 src=ROOT/'audit/skill-assets/sources/skill-sheets'/rec['sourceSheet'];before=Image.open(src).convert('RGB');before.thumbnail((500,260),Image.Resampling.LANCZOS)
 after=Image.open(OUT/f'{fid}.jpg').convert('RGB');after.thumbnail((700,260),Image.Resampling.LANCZOS)
 row=Image.new('RGB',(1220,300),(18,18,18));row.paste(before,(10,28));row.paste(after,(510,28));ImageDraw.Draw(row).text((10,8),f'{fid} BEFORE source sheet        AFTER isolated RGBA assets',font=font,fill='white');rows.append(row)
out=Image.new('RGB',(1220,300*len(rows)),(12,12,12))
for i,r in enumerate(rows):out.paste(r,(0,i*300))
out.save(OUT/'before_after_contact_sheet.jpg',quality=90)
print(OUT)
