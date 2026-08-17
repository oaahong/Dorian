#!/usr/bin/env python3
from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
manifest=json.loads((ROOT/'audit/skill-assets/skill-asset-manifest.json').read_text())
base=json.loads((ROOT/'audit/skill-assets/base-pose-sha256.json').read_text())
warnings=[];stats={'files':0,'rgba':0,'transparent':0,'gridLineWarnings':0,'edgeOpaqueWarnings':0,'basePoseRegression':0,'missing':0,'backgrounds':0}

def warn(kind,path,detail): warnings.append({'kind':kind,'path':path,'detail':detail});stats[kind]+=1 if kind in stats else 0
for fid,rec in manifest['fighters'].items():
 for a in rec['assets']+rec.get('derivedAssets',[]):
  p=ROOT/a['outputPath'];stats['files']+=1
  if not p.exists():stats['missing']+=1;warnings.append({'kind':'missing','path':str(p),'detail':'expected asset absent'});continue
  im=Image.open(p)
  if im.mode=='RGBA':stats['rgba']+=1
  else:warnings.append({'kind':'mode','path':str(p),'detail':im.mode})
  arr=np.asarray(im.convert('RGBA'));alpha=arr[:,:,3]
  if (alpha==0).any():stats['transparent']+=1
  else:warnings.append({'kind':'alpha','path':str(p),'detail':'no fully transparent pixel'})
  # Only flag near-complete neutral rules, not legitimate beams/speed lines.
  rgb=arr[:,:,:3].astype(np.int16);neutral=(rgb.max(2)-rgb.min(2)<16)&(rgb.mean(2)>32)&(alpha>200)
  row=neutral.mean(1);col=neutral.mean(0)
  if (row>.94).any() or (col>.94).any():
   stats['gridLineWarnings']+=1;warnings.append({'kind':'gridLineWarnings','path':str(p.relative_to(ROOT)),'detail':'near-complete neutral line detected'})
  # Opaque rectangular framing at every edge is suspicious; a touching VFX on one edge is valid.
  edge=[(alpha[0]>220).mean(),(alpha[-1]>220).mean(),(alpha[:,0]>220).mean(),(alpha[:,-1]>220).mean()]
  if sum(v>.90 for v in edge)>=3:
   stats['edgeOpaqueWarnings']+=1;warnings.append({'kind':'edgeOpaqueWarnings','path':str(p.relative_to(ROOT)),'detail':edge})
for fid,b in manifest['backgrounds'].items():
 p=ROOT/b['outputPath']
 if p.exists():stats['backgrounds']+=1
 else:stats['missing']+=1;warnings.append({'kind':'missing','path':str(p),'detail':'background absent'})
for rel,h in base.items():
 p=ROOT/rel
 if not p.exists() or hashlib.sha256(p.read_bytes()).hexdigest()!=h:
  stats['basePoseRegression']+=1;warnings.append({'kind':'basePoseRegression','path':rel,'detail':'base 30-pose pipeline output changed'})
out={'stats':stats,'warningCount':len(warnings),'warnings':warnings}
(ROOT/'audit/skill-assets/validation.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
print(json.dumps(out,ensure_ascii=False))
raise SystemExit(1 if stats['missing'] or stats['basePoseRegression'] or stats['files']!=226 or stats['rgba']!=226 or stats['transparent']!=226 else 0)
