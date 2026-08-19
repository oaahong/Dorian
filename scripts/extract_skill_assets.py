#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
from collections import deque
import zipfile, shutil, json, hashlib, re
import asset_format
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
SKILL_ZIP=ROOT/'asset_pipeline_backups/skill-sheets-source.zip'
BG_ZIP=ROOT/'asset_pipeline_backups/ultimate-backgrounds-source.zip'
SRC=ROOT/'audit/skill-assets/sources'
OUT=ROOT/'public/assets/skills'
BGOUT=ROOT/'public/assets/ultimate-backgrounds'
CFG=ROOT/'scripts/skill_crop_config.json'
MANIFEST=ROOT/'audit/skill-assets/skill-asset-manifest.json'
VALIDATION=ROOT/'audit/skill-assets/generation-validation.json'

SHEETS={
 'alien':('Alien cat必殺技.png',[4,4,4,4],list('ABCDEFGHIJKLMNOP')),
 'doge':('Doge必殺技.jpg',[6,6,6],list('ABCDEFGHIJKLMNOPQR')),
 'ya':('YA鼠必殺技.jpg',[5,5,4],list('ABCDEFGHIJKLMN')),
 'tempura':('Oh fucking 天婦羅尬哩涼必殺技.png',[4,4,4,4],list('ABCDEFGHIJKLMNOP')),
 'goblin':('哥布林也想談戀愛必殺技.png',[5,5,5,5,3],list('ABCDEFGHIJKLMNOPQRSTUVW')),
 'salad':('沙拉貓貓必殺技.png',[5,5,5,5],['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','L2','M2','N2','O2','P']),
 'wizard':('魔法胖橘貓必殺技.png',[6,6,6],list('ABCDEFGHIJKLMNOPQR')),
 'blade':('我的刀盾必殺技.png',[6,6,6],list('ABCDEFGHIJKLMNOPQR')),
 'pink':('粉紅星星必殺技.png',[5,5,5,5,3],list('ABCDEFGHIJKLMNOPQRSTUVW')),
 'sauce':('蘸醬胡渣狗必殺技.png',[5,5,5],list('ABCDEFGHIJKLMNO')),
 'scared':('驚嚇小貓必殺技.png',[6,6,6,4],list('ABCDEFGHIJKLMNOPQRSTUV')),
 'ok':('OK喵老大必殺技.png',[7,7,7],list('ABCDEFGHIJKLMNOPQRSTU')),
}
BACKGROUNDS={
 'alien':'Alien cat背景.png','doge':'Doge-背景.png','ya':'YA鼠-背景.png','tempura':'Oh fucking 天婦羅尬哩涼-背景.png','goblin':'哥布林也想談戀愛-背景.png','salad':'沙拉貓貓背景.png','wizard':'魔法胖橘貓背景.png','blade':'我的刀盾-背景.png','pink':'粉紅星星-背景.png','sauce':'蘸醬胡渣狗-背景.png','scared':'驚嚇小貓-背景.png','ok':'OK喵老大-背景.png'
}

def decoded(name:str)->str:
    try:return name.encode('cp437').decode('utf-8')
    except Exception:return name

def extract(zip_path:Path,dest:Path):
    if dest.exists():shutil.rmtree(dest)
    dest.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            if info.is_dir():continue
            name=decoded(info.filename)
            base=Path(name).name
            if '__MACOSX' in name or base=='.DS_Store' or base.startswith('._'):continue
            p=dest/base
            p.write_bytes(z.read(info))

def groups(ids:list[int],gap=2):
    if not ids:return []
    out=[[ids[0]]]
    for v in ids[1:]:
        if v-out[-1][-1]<=gap:out[-1].append(v)
        else:out.append([v])
    return out

def measure_rects(img:Image.Image,row_cells:list[int],fid:str):
    w,h=img.size
    if fid=='salad' and (w,h)==(1145,1374):
        xs=[(16,206),(232,429),(455,642),(668,869),(896,1091)]
        ys=[(15,286),(363,638),(711,1008),(1088,1274)]
        return [(xs[c][0],ys[r][0],xs[c][1],ys[r][1]) for r,n in enumerate(row_cells) for c in range(n)]
    if fid=='doge' and (w,h)==(1536,1024):
        xs=[(16,250),(254,487),(490,741),(745,1012),(1016,1237),(1241,1518)]
        ys=[(14,271),(329,572),(630,890)]
        return [(xs[c][0],ys[r][0],xs[c][1],ys[r][1]) for r,n in enumerate(row_cells) for c in range(n)]
    a=np.asarray(img.convert('RGB')).astype(np.int16)
    mx=a.max(2);mn=a.min(2);bright=a.mean(2);neutral=(mx-mn<22)&(bright>18)&(bright<252)
    rm=neutral.mean(1)
    hg=groups(np.where(rm>.50)[0].tolist(),2)
    hcent=[int(np.mean(g)) for g in hg if len(g)>=1]
    approx=np.linspace(0,h,len(row_cells)+1)
    rects=[]
    for r,n in enumerate(row_cells):
        lo,hi=int(approx[r]),int(approx[r+1])
        before=[y for y in hcent if abs(y-lo)<max(65,h//20)]
        after=[y for y in hcent if abs(y-hi)<max(65,h//20)]
        y0=(before[-1]+7) if before else lo+7
        y1=(after[0]-7) if after else hi-7
        if fid=='pink':y0=max(y0,lo+34)
        band=neutral[max(y0,0):max(y1,y0+1)]
        cm=band.mean(0) if band.size else neutral[lo:hi].mean(0)
        vg=groups(np.where(cm>.90)[0].tolist(),2)
        vg=[g for g in vg if len(g)>=1]
        if len(vg)>=2*n:
            bounds=[(vg[2*c][-1]+7,vg[2*c+1][0]-7) for c in range(n)]
        elif len(vg)>=n+1:
            bounds=[(vg[c][-1]+7,vg[c+1][0]-7) for c in range(n)]
        else:
            cuts=np.linspace(0,w,n+1,dtype=int); bounds=[(int(cuts[c])+7,int(cuts[c+1])-7) for c in range(n)]
        # caption strip is commonly below artwork; find a long horizontal separator near lower quarter.
        local=rm[y0:y1]
        sep=np.where(local>.62)[0]
        sg=groups(sep.tolist(),2)
        for g in sg:
            yy=y0+g[0]
            if yy>y0+(y1-y0)*.57:
                y1=min(y1,yy-7);break
        for x0,x1 in bounds:rects.append((max(0,x0),max(0,y0),min(w,x1),min(h,y1)))
    return rects

def flood_edge_dark(rgba:np.ndarray,threshold:int):
    rgb=rgba[:,:,:3].astype(np.int16); h,w=rgb.shape[:2]
    # Background candidate: dark and close to neutral. JPEG allows a wider threshold.
    mx=rgb.max(2);mn=rgb.min(2); lum=rgb.mean(2)
    cand=(lum<threshold)&((mx-mn)<max(26,threshold//2))
    seen=np.zeros((h,w),bool);q=deque()
    for x in range(w):
        if cand[0,x]:seen[0,x]=1;q.append((0,x))
        if cand[h-1,x]:seen[h-1,x]=1;q.append((h-1,x))
    for y in range(h):
        if cand[y,0] and not seen[y,0]:seen[y,0]=1;q.append((y,0))
        if cand[y,w-1] and not seen[y,w-1]:seen[y,w-1]=1;q.append((y,w-1))
    while q:
        y,x=q.popleft()
        for yy,xx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
            if 0<=yy<h and 0<=xx<w and cand[yy,xx] and not seen[yy,xx]:seen[yy,xx]=1;q.append((yy,xx))
    rgba[seen,3]=0
    return rgba

def cleanup_frame(rgba:np.ndarray):
    # Remove only long neutral rules at the extreme crop edge, never internal content.
    h,w=rgba.shape[:2];rgb=rgba[:,:,:3].astype(np.int16);a=rgba[:,:,3]
    neutral=(rgb.max(2)-rgb.min(2)<20)&(rgb.mean(2)>25)&(a>0)
    for y in list(range(min(20,h)))+list(range(max(0,h-20),h)):
        if neutral[y].mean()>.78:
            if y<h//2:a[:y+2,:]=0
            else:a[max(0,y-1):,:]=0
    for x in list(range(min(20,w)))+list(range(max(0,w-20),w)):
        if neutral[:,x].mean()>.78:
            if x<w//2:a[:,:x+2]=0
            else:a[:,max(0,x-1):]=0
    rgba[:,:,3]=a;return rgba

def tight(rgba:np.ndarray,pad=6):
    a=rgba[:,:,3];ys,xs=np.where(a>8)
    if len(xs)==0:return rgba
    x0=max(0,int(xs.min())-pad);x1=min(rgba.shape[1],int(xs.max())+pad+1);y0=max(0,int(ys.min())-pad);y1=min(rgba.shape[0],int(ys.max())+pad+1)
    return rgba[y0:y1,x0:x1]

def clean_cell(img:Image.Image,fid:str,is_jpg:bool):
    rgba=np.asarray(img.convert('RGBA')).copy()
    # Pink labels are printed at the top of cells. Remove only neutral label ink in the top strip.
    if fid=='pink':
        rgba[:min(8,rgba.shape[0]),:,:3]=0
        rgb=rgba[:,:,:3].astype(np.int16);ch=rgb.max(2)-rgb.min(2);br=rgb.mean(2)
        top=min(20,rgba.shape[0]);mask=(ch[:top]<24)&(br[:top]>125);rgba[:top,:,3][mask]=0
    rgba=flood_edge_dark(rgba,64 if is_jpg else 42)
    rgba=cleanup_frame(rgba)
    rgba=tight(rgba,6)
    return Image.fromarray(rgba,'RGBA')

def sha(p:Path):return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    skill_src=SRC/'skill-sheets'; bg_src=SRC/'ultimate-backgrounds';extract(SKILL_ZIP,skill_src);extract(BG_ZIP,bg_src)
    OUT.mkdir(parents=True,exist_ok=True);BGOUT.mkdir(parents=True,exist_ok=True)
    crop_cfg={}; manifest={'version':1,'sourcePipeline':'scripts/extract_skill_assets.py','fighters':{},'backgrounds':{}}
    expected=0
    for fid,(fname,row_cells,labels) in SHEETS.items():
        src=skill_src/fname
        if not src.exists():raise FileNotFoundError(src)
        im=Image.open(src);rects=measure_rects(im,row_cells,fid)
        if len(rects)!=len(labels):raise RuntimeError(f'{fid}: rects {len(rects)} labels {len(labels)}')
        crop_cfg[fid]={}; entries=[]; outdir=OUT/fid;outdir.mkdir(parents=True,exist_ok=True)
        for label,rect in zip(labels,rects):
            x0,y0,x1,y1=rect; crop_cfg[fid][label]={'rect':[x0,y0,x1,y1],'note':'measured source cell; caption/grid excluded'}
            cell=im.crop(rect);clean=clean_cell(cell,fid,src.suffix.lower() in ('.jpg','.jpeg'))
            op=outdir/f'{label}{asset_format.suffix()}';asset_format.save(clean,op)
            category='H_CHARGE_FIGHTER' if label in ('A','B','C') else 'H_RELEASE_FIGHTER' if label=='D' else 'H_OR_SHARED_VFX' if label in ('E','F','G') else 'ULTIMATE_MODULE'
            entries.append({'poseId':label,'textureId':f'skill-{fid}-{label.lower()}','sourceSheet':fname,'sourceRect':[x0,y0,x1,y1],'outputPath':str(op.relative_to(ROOT)).replace('\\','/'),'pivot':[0.5,1.0] if category.endswith('FIGHTER') else [0.5,0.5],'anchor':'feet' if category.endswith('FIGHTER') else 'center','feetBaseline':1.0 if category.endswith('FIGHTER') else None,'category':category,'runtimeUsage':'Chargeable Special H / Ultimate module','size':list(clean.size),'sha256':sha(op)})
        manifest['fighters'][fid]={'sourceSheet':fname,'assets':entries};expected+=len(entries)
    # Source cell K for Blade contains two clearly separated sword components. Derive two independent attached weapon modules without redrawing.
    blade_k=OUT/'blade'/f'K{asset_format.suffix()}'
    karr=np.asarray(Image.open(blade_k).convert('RGBA')).copy(); occ=(karr[:,:,3]>8).any(0); idx=np.where(occ)[0]
    if len(idx):
        runs=[];start=None
        for x in range(int(idx.min()),int(idx.max())+1):
            if not occ[x] and start is None:start=x
            if occ[x] and start is not None:runs.append((start,x-1));start=None
        if start is not None:runs.append((start,int(idx.max())))
        gaps=[r for r in runs if r[1]-r[0]+1>=4]
        split=int((idx.min()+idx.max())/2) if not gaps else int((max(gaps,key=lambda r:r[1]-r[0])[0]+max(gaps,key=lambda r:r[1]-r[0])[1])/2)
        derived=[]
        for name,arr in [('K_weapon_blue',karr[:,:split+1]),('K_weapon_black',karr[:,split+1:])]:
            arr=tight(arr.copy(),4);op=OUT/'blade'/f'{name}{asset_format.suffix()}';asset_format.save(Image.fromarray(arr,'RGBA'),op);derived.append({'poseId':name,'textureId':f'skill-blade-{name.lower()}','sourceSheet':SHEETS['blade'][0],'sourceRect':'derived from source cell K connected spatial component','outputPath':str(op.relative_to(ROOT)).replace('\\','/'),'pivot':[0.5,0.5],'anchor':'weapon socket','feetBaseline':None,'category':'WEAPON','runtimeUsage':'DUAL_HEAVY independent attached sword','size':[arr.shape[1],arr.shape[0]],'sha256':sha(op)})
        manifest['fighters']['blade']['derivedAssets']=derived
    for fid,fname in BACKGROUNDS.items():
        src=bg_src/fname
        if not src.exists():raise FileNotFoundError(src)
        # Cropped, not copied: 40% of every source background is margin the cut-in
        # can never show. See asset_format.ULTIMATE_BG_SIZE for the geometry.
        op=BGOUT/f'{fid}{asset_format.suffix()}';full=Image.open(src)
        cw,ch=asset_format.ULTIMATE_BG_SIZE;l=(full.width-cw)//2;t=(full.height-ch)//2
        if l<0 or t<0:raise ValueError(f'{fid}: source {full.size} smaller than {cw}x{ch} crop')
        asset_format.save(full.crop((l,t,l+cw,t+ch)),op);im=Image.open(op)
        manifest['backgrounds'][fid]={'source':fname,'textureId':f'ultimate-bg-{fid}','outputPath':str(op.relative_to(ROOT)).replace('\\','/'),'size':list(im.size),'mode':im.mode,'sha256':sha(op)}
    CFG.write_text(json.dumps(crop_cfg,ensure_ascii=False,indent=2),encoding='utf8');MANIFEST.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    VALIDATION.write_text(json.dumps({'expectedSourceCells':expected,'expectedGenerated':expected+2,'generated':sum(1 for _ in OUT.glob(asset_format.glob_pattern('*/*'))),'backgrounds':sum(1 for _ in BGOUT.glob(asset_format.glob_pattern()))},indent=2),encoding='utf8')
    print(json.dumps({'expectedSourceCells':expected,'expectedGenerated':expected+2,'generated':sum(1 for _ in OUT.glob(asset_format.glob_pattern('*/*'))),'backgrounds':sum(1 for _ in BGOUT.glob(asset_format.glob_pattern()))},ensure_ascii=False))
if __name__=='__main__':main()
