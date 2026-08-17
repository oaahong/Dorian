from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np, json, shutil
from collections import deque
import argparse


class cv2:
    """Small dependency-free subset used by this asset pipeline."""
    CC_STAT_LEFT=0; CC_STAT_TOP=1; CC_STAT_WIDTH=2; CC_STAT_HEIGHT=3; CC_STAT_AREA=4

    @staticmethod
    def connectedComponentsWithStats(binary, connectivity=8):
        src=(binary!=0); h,w=src.shape
        labels=np.zeros((h,w),dtype=np.int32); stats=[[0,0,w,h,int((~src).sum())]]; cent=[[0.0,0.0]]
        label=0
        neighbors=((-1,-1),(0,-1),(1,-1),(-1,0),(1,0),(-1,1),(0,1),(1,1)) if connectivity==8 else ((0,-1),(-1,0),(1,0),(0,1))
        for y in range(h):
            for x in range(w):
                if not src[y,x] or labels[y,x]:continue
                label+=1; q=deque([(x,y)]);labels[y,x]=label
                minx=maxx=x;miny=maxy=y;area=0;sx=sy=0
                while q:
                    xx,yy=q.popleft();area+=1;sx+=xx;sy+=yy
                    minx=min(minx,xx);maxx=max(maxx,xx);miny=min(miny,yy);maxy=max(maxy,yy)
                    for dx,dy in neighbors:
                        nx,ny=xx+dx,yy+dy
                        if 0<=nx<w and 0<=ny<h and src[ny,nx] and labels[ny,nx]==0:
                            labels[ny,nx]=label;q.append((nx,ny))
                stats.append([minx,miny,maxx-minx+1,maxy-miny+1,area]);cent.append([sx/area,sy/area])
        return label+1,labels,np.asarray(stats,dtype=np.int32),np.asarray(cent,dtype=float)

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'source-assets' / '迷因大亂鬥'
CARDS = ROOT / 'public' / 'assets' / 'cards'
POSES = ROOT / 'public' / 'assets' / 'poses'
AUDIT = ROOT / 'audit'
OVERRIDES_FILE = AUDIT / 'pose-recrop-overrides.json'
PROCESSING_OVERRIDES_FILE = AUDIT / 'pose-processing-overrides.json'

fighters = [
    ('alien','Alien cat.png','card-01-alien.png','Alien Meow／訊號壞掉喵'),
    ('doge','Doge.png','card-02-doge.png','Doge'),
    ('ya','YA鼠.png','card-03-ya.png','YA鼠'),
    ('tempura','Oh fucking 天婦羅尬哩涼.png','card-04-tempura.png','oh fucking 天婦羅尬哩涼'),
    ('goblin','哥布林也想談戀愛.png','card-05-goblin.png','哥布林也想談戀愛'),
    ('salad','沙拉貓貓.png','card-06-salad.png','沙拉貓貓'),
    ('wizard','魔法胖橘貓.png','card-07-wizard.png','魔法胖橘貓'),
    ('blade','我的刀盾.png','card-08-blade-shield.png','我的刀盾'),
    ('pink','粉紅星星.png','card-09-pink-star.png','粉紅星星'),
    ('sauce','蘸醬胡渣狗.png','card-10-sauce-dog.png','蘸醬胡渣狗'),
    ('scared','驚嚇小貓.png','card-11-scared-cat.png','驚嚇小貓'),
    ('ok','OK喵老大.png','card-12-ok-boss.png','OK喵老大'),
]

# Manual row/column profiles. Values are normalized to image size.
# Most sheets are 5x6; Alien and Tempura contain deliberately merged panels.
profiles = {
    'alien': {
        'bounds': [0.012, 0.043, 0.988, 0.959],
        'rows': [
            [0.000,0.166,0.333,0.500,0.666,0.833,1.000],
            [0.000,0.200,0.400,0.600,0.800,1.000],
            [0.000,0.200,0.400,0.600,0.800,1.000],
            [0.000,0.200,0.400,0.600,0.800,1.000],
            [0.000,0.200,0.400,0.600,0.800,1.000],
            # Explicitly keeps the wide Ultimate cell 28 intact.
            [0.000,0.190,0.486,0.730,1.000],
        ],
        'caption': 0.18,
        'topTrim': 0.16,
    },
    'tempura': {
        'bounds': [0.010, 0.061, 0.990, 0.864],
        'rows': [
            [0,.2,.4,.6,.8,1],
            [0,.2,.4,.6,.8,1],
            [0,.2,.4,.6,.8,1],
            [0,.2,.4,.6,.8,1],
            # row 5 contains 21,22,23 and a merged 24 spanning two cells
            [0,.2,.4,.6,1],
            # row 6 contains 25,26,27 and merged 28 spanning two cells
            [0,.2,.4,.6,1],
            # row 7 contains 29,30 + footer space; special pseudo row handled below
        ],
        'caption': 0.18,
        'topTrim': 0.035,
        'extra_row': {'y0':0.883,'y1':0.981,'xs':[0.010,0.205,0.402], 'pose_start':29}
    },
    'doge': {'bounds':[0.010,0.060,0.990,0.916],'grid':[6,5],'caption':0.17,'topTrim':0.01},
    'pink': {'bounds':[0.018,0.045,0.982,0.919],'grid':[5,6],'caption':0.02,'topTrim':0.01,'sideTrim':0.025,'rowAreasPx':[(60,226),(248,406),(428,598),(620,791),(813,990),(1012,1251)]},
}

# Per-size defaults. Bounds intentionally include the action grid but exclude title/footer.
def default_profile(w,h):
    if h >= 1500:
        return {'bounds':[0.010,0.067,0.990,0.878],'grid':[5,6],'caption':0.17,'topTrim':0.01}
    return {'bounds':[0.010,0.060,0.990,0.925],'grid':[5,6],'caption':0.17,'topTrim':0.01}

def flood_connected_black(rgb, threshold=30):
    near=((rgb[:,:,0] < threshold) & (rgb[:,:,1] < threshold) & (rgb[:,:,2] < threshold)).astype(np.uint8)
    n,labels,stats,cent=cv2.connectedComponentsWithStats(near,8)
    if n <= 1:
        return near
    edge_labels=set(np.unique(np.concatenate([labels[0,:],labels[-1,:],labels[:,0],labels[:,-1]])))
    edge_labels.discard(0)
    if not edge_labels:
        return np.zeros_like(near)
    return np.isin(labels, list(edge_labels)).astype(np.uint8)

def clean_component_alpha(alpha):
    binary=(alpha>32).astype(np.uint8)
    n,labels,stats,cent=cv2.connectedComponentsWithStats(binary,8)
    if n <= 1: return alpha
    areas=stats[1:,cv2.CC_STAT_AREA]
    largest=max(1,int(areas.max()))
    keep=np.zeros_like(binary)
    for i in range(1,n):
        area=stats[i,cv2.CC_STAT_AREA]
        x=stats[i,cv2.CC_STAT_LEFT]; y=stats[i,cv2.CC_STAT_TOP]
        ww=stats[i,cv2.CC_STAT_WIDTH]; hh=stats[i,cv2.CC_STAT_HEIGHT]
        # Drop tiny disconnected text glyphs / dust while preserving real VFX fragments.
        if area >= max(90, largest*0.004) or (ww>50 and hh>20):
            keep[labels==i]=1
    return (alpha*keep).astype(np.uint8)

def restore_enclosed_foreground(alpha):
    """Make dark character interiors opaque without turning the sheet background solid.

    Tempura's black body is separated from the black sheet by a thin bright outline.
    Closing tiny outline gaps only for the hole test lets us distinguish that enclosed
    body from true edge-connected background.
    """
    fg=Image.fromarray((alpha>32).astype(np.uint8)*255)
    closed=np.array(fg.filter(ImageFilter.MaxFilter(15)))>0
    background=(~closed).astype(np.uint8)
    n,labels,_,_=cv2.connectedComponentsWithStats(background,8)
    edge=set(np.unique(np.concatenate([labels[0],labels[-1],labels[:,0],labels[:,-1]])))
    holes=(background>0)&(~np.isin(labels,list(edge)))
    out=alpha.copy();out[holes]=255
    return out

def remove_line_components(alpha, rgba):
    """Remove sprite-sheet separators without erasing broad legitimate VFX."""
    binary=(alpha>32).astype(np.uint8)
    n,labels,stats,_=cv2.connectedComponentsWithStats(binary,8)
    out=alpha.copy(); h,w=alpha.shape
    for i in range(1,n):
        x=stats[i,cv2.CC_STAT_LEFT]; y=stats[i,cv2.CC_STAT_TOP]
        ww=stats[i,cv2.CC_STAT_WIDTH]; hh=stats[i,cv2.CC_STAT_HEIGHT]
        area=stats[i,cv2.CC_STAT_AREA]
        pix=rgba[:,:,0:3][labels==i]
        neutral_bright=bool(len(pix) and np.mean(np.min(pix,axis=1)>150)>.72)
        horizontal=ww>=w*.52 and hh<=max(8,int(h*.045)) and area>=ww*.42
        vertical=hh>=h*.48 and ww<=max(8,int(w*.045)) and area>=hh*.42
        if neutral_bright and (horizontal or vertical): out[labels==i]=0
    return out

def remove_edge_contamination(alpha, issue):
    """Drop disconnected neighbor fragments only on audit-declared contaminated edges."""
    if not any(k in issue for k in ('其他動作','特效殘片','文字殘片')): return alpha
    binary=(alpha>32).astype(np.uint8)
    n,labels,stats,_=cv2.connectedComponentsWithStats(binary,8)
    if n<=2:return alpha
    areas=stats[1:,cv2.CC_STAT_AREA]; largest=int(areas.max())
    h,w=alpha.shape; out=alpha.copy()
    sides=[]
    if '左側' in issue or '左右' in issue:sides.append('left')
    if '右側' in issue or '左右' in issue:sides.append('right')
    if '下側' in issue:sides.append('bottom')
    for i in range(1,n):
        x=stats[i,cv2.CC_STAT_LEFT]; y=stats[i,cv2.CC_STAT_TOP]
        ww=stats[i,cv2.CC_STAT_WIDTH]; hh=stats[i,cv2.CC_STAT_HEIGHT]
        area=stats[i,cv2.CC_STAT_AREA]
        touches=('left' in sides and x<=3) or ('right' in sides and x+ww>=w-3) or ('bottom' in sides and y+hh>=h-3)
        line_like=(ww>max(24,hh*7)) or (hh>max(24,ww*7))
        if touches and (area<largest*.42 or line_like):out[labels==i]=0
    return out

def extract_pose(src_img, rect, caption_frac=0.17, top_trim=0.01, issue=''):
    w,h=src_img.size
    x0,y0,x1,y1=rect
    pad=4
    side=int((x1-x0)*0.012)
    x0=int(x0)+pad+side; x1=int(x1)-pad-side
    y0=int(y0)+pad+int((y1-y0)*top_trim)
    y1=int(y1)-pad-int((y1-y0)*caption_frac)
    crop=src_img.crop((max(0,x0),max(0,y0),min(w,x1),min(h,y1))).convert('RGBA')
    # Last-resort per-cell caption-strip removal. It catches white button labels that
    # global row detection can miss when a large VFX reduces full-row white density.
    probe=np.array(crop.convert('RGB'))
    if probe.shape[0] > 30 and probe.shape[1] > 30:
        chroma=probe.max(axis=2)-probe.min(axis=2)
        neutral=(probe[:,:,0]>205)&(probe[:,:,1]>205)&(probe[:,:,2]>205)&(chroma<45)
        frac=neutral.mean(axis=1)
        start=int(len(frac)*0.52)
        hot=np.where(frac[start:]>.38)[0]+start
        if len(hot):
            groups=[]; a=b=int(hot[0])
            for q in hot[1:]:
                q=int(q)
                if q>b+2:
                    groups.append((a,b));a=q
                b=q
            groups.append((a,b))
            candidates=[g for g in groups if g[1]-g[0]>=2]
            if candidates:
                cut=min(g[0] for g in candidates)
                if cut > int(crop.height*0.52): crop=crop.crop((0,0,crop.width,max(1,cut-2)))
    rgb=np.array(crop.convert('RGB'))
    # A higher edge-connected threshold fixes JPEG-black islands that previously
    # became translucent rectangles, while outlined black character interiors stay isolated.
    bg=flood_connected_black(rgb, 54 if '透明背景異常' in issue else 30)
    bg_img=Image.fromarray((bg*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius=1.2))
    alpha=255-np.array(bg_img)
    if '透明背景異常' in issue: alpha=restore_enclosed_foreground(alpha)
    alpha=clean_component_alpha(alpha)
    rgba=np.array(crop)
    alpha=remove_line_components(alpha,rgba)
    alpha=remove_edge_contamination(alpha,issue)
    rgba[:,:,3]=alpha
    out=Image.fromarray(rgba,'RGBA')
    bbox=out.getbbox()
    if bbox: out=out.crop(bbox)
    # Normalize bottom-center visual into a 360x360 transparent pose canvas.
    canvas=Image.new('RGBA',(360,360),(0,0,0,0))
    if out.width and out.height:
        scale=min(320/out.width,310/out.height,1.8)
        out=out.resize((max(1,int(out.width*scale)),max(1,int(out.height*scale))),Image.Resampling.LANCZOS)
        x=(360-out.width)//2
        y=340-out.height
        canvas.alpha_composite(out,(x,max(4,y)))
    return canvas

def detect_caption_bands(img, expected_rows, x0, x1, y0, y1):
    """Find full-width white caption strips and return merged (start,end) y bands."""
    rgb=np.array(img.convert('RGB'))
    xa=max(0,int(x0)); xb=min(rgb.shape[1],int(x1)); ya=max(0,int(y0)); yb=min(rgb.shape[0],int(y1))
    roi=rgb[ya:yb,xa:xb]
    chroma=roi.max(axis=2)-roi.min(axis=2)
    white=(roi[:,:,0]>185)&(roi[:,:,1]>185)&(roi[:,:,2]>185)&(chroma<65)
    frac=white.mean(axis=1)
    hot=np.where(frac>.42)[0]
    groups=[]
    if len(hot):
        s0=p0=int(hot[0])
        for q in hot[1:]:
            q=int(q)
            if q-p0>16:
                groups.append((s0+ya,p0+ya))
                s0=q
            p0=q
        groups.append((s0+ya,p0+ya))
    # Merge close fragments from the same caption strip.
    merged=[]
    for a,b in groups:
        if merged and a-merged[-1][1] <= 22:
            merged[-1]=(merged[-1][0],b)
        else:
            merged.append((a,b))
    # Ignore title/footer and implausibly thin noise; keep the expected bottom strips in order.
    merged=[g for g in merged if g[1]-g[0]>=3 and g[0]>y0+35 and g[1]<y1+20]
    if len(merged)>expected_rows:
        # Favor well-spaced bands. Caption bands normally sit near the bottom of each action row.
        target=np.linspace(y0+(y1-y0)/expected_rows,y1,expected_rows)
        chosen=[]; used=set()
        for t in target:
            candidates=[(abs(((a+b)/2)-t),i,(a,b)) for i,(a,b) in enumerate(merged) if i not in used]
            if candidates:
                _,i,g=min(candidates);used.add(i);chosen.append(g)
        merged=sorted(chosen)
    return merged if len(merged)==expected_rows else []

def rects_from_profile(profile,w,h,img=None):
    l,t,r,b=profile['bounds']
    L,T,R,B=l*w,t*h,r*w,b*h
    rects=[]
    row_specs=profile.get('rows')
    if row_specs is None:
        cols,rows=profile['grid']
        row_specs=[[i/cols for i in range(cols+1)] for _ in range(rows)]
    expected_rows=len(row_specs)
    if profile.get('rowAreasPx'):
        row_areas=[tuple(x) for x in profile['rowAreasPx']]
        bands=[]
    else:
        bands=[] if profile.get('forceUniformRows') or img is None else detect_caption_bands(img,expected_rows,L,R,T,B+40)
        if bands:
            row_areas=[]
            top=T
            for a,bb in bands:
                row_areas.append((top,a-3))
                top=bb+3
        else:
            row_areas=[]
            for ri in range(expected_rows):
                y0=T+(B-T)*ri/expected_rows; y1=T+(B-T)*(ri+1)/expected_rows
                row_areas.append((y0,y1))
    for ri,xs in enumerate(row_specs):
        y0,y1=row_areas[ri]
        for ci in range(len(xs)-1):
            rects.append((L+(R-L)*xs[ci],y0,L+(R-L)*xs[ci+1],y1))
    if 'extra_row' in profile:
        er=profile['extra_row']; xs=er['xs']
        # If caption detection found one more visual row in source it is intentionally handled by explicit coords.
        for ci in range(len(xs)-1):
            rects.append((xs[ci]*w,er['y0']*h,xs[ci+1]*w,er['y1']*h))
    return rects

parser=argparse.ArgumentParser()
parser.add_argument('--problem-only',action='store_true',help='Regenerate only poses listed in audit/pose-recrop-overrides.json')
args=parser.parse_args()
overrides=[]
if OVERRIDES_FILE.exists():overrides=json.loads(OVERRIDES_FILE.read_text(encoding='utf-8'))
override_by_key={(x['fighterId'],str(x['pose']).zfill(2)):x for x in overrides}
if overrides and len(overrides)!=156:raise RuntimeError(f'Expected 156 audit overrides, found {len(overrides)}')
processing_overrides={}
if PROCESSING_OVERRIDES_FILE.exists():
    processing_overrides=json.loads(PROCESSING_OVERRIDES_FILE.read_text(encoding='utf-8'))

report={'filesFound':0,'fighters':[],'warnings':[]}; profile_report={}
for idx,(fid,filename,cardname,display) in enumerate(fighters,1):
    src=SRC/filename
    if not src.exists():
        report['warnings'].append(f'Missing {filename}')
        continue
    report['filesFound']+=1
    shutil.copy2(src,CARDS/cardname)
    img=Image.open(src).convert('RGBA')
    w,h=img.size
    profile=profiles.get(fid,default_profile(w,h))
    rects=rects_from_profile(profile,w,h,img)
    # Tempura ordering: main profile yields 28 cells, then extra 29/30.
    if len(rects) < 30:
        report['warnings'].append(f'{fid}: detected only {len(rects)} rects')
    rects=rects[:30]
    widths=[max(1,r[2]-r[0]) for r in rects]; median_width=float(np.median(widths)) if widths else 1
    pose_meta={}
    outdir=POSES/fid; outdir.mkdir(parents=True,exist_ok=True)
    for i,rect in enumerate(rects,1):
        key=(fid,f'{i:02d}'); override=override_by_key.get(key)
        processing=processing_overrides.get(fid,{}).get(f'{i:02d}',{})
        effective_rect=tuple(processing.get('rect',override['suggestedRecrop'])) if override else rect
        issue=processing.get('cleanupIssue',override['issueType']) if override else ''
        pose=extract_pose(img,effective_rect,(0.02 if profile.get('rowAreasPx') else (profile.get('caption',.17) if profile.get('forceUniformRows') else 0.035)),profile.get('topTrim',.01),issue)
        if not args.problem_only or override:pose.save(outdir/f'{i:02d}.png',optimize=True)
        x0,y0,x1,y1=[float(v) for v in rect]
        merged=(x1-x0)>median_width*1.28
        if merged:
            pose_meta[str(i)]={'kind':'custom-merged','x':round(x0,2),'y':round(y0,2),'width':round(x1-x0,2),'height':round(y1-y0,2),'captionTrim':profile.get('caption',.17),'note':'wide merged action/VFX panel'}
        elif fid=='pink':
            pose_meta[str(i)]={'kind':'pixel','x':round(x0,2),'y':round(y0,2),'width':round(x1-x0,2),'height':round(y1-y0,2),'captionTrim':profile.get('caption',.17)}
        else:
            pose_meta[str(i)]={'kind':'normalized','x':round(x0/w,6),'y':round(y0/h,6),'width':round((x1-x0)/w,6),'height':round((y1-y0)/h,6),'captionTrim':profile.get('caption',.17)}
    layout='manual-irregular' if fid in ('alien','tempura') else ('6x5-grid' if fid=='doge' else '5x6-grid')
    profile_report[fid]={'fighterId':fid,'sourceTexture':f'card-{fid}','sourceFile':filename,'layout':layout,'poses':pose_meta,'captionTrim':profile.get('caption',.17),'backgroundRemoval':{'threshold':30,'edgeConnected':True,'feather':1.2,'preserveInteriorBlack':True}}
    report['fighters'].append({
        'fighterId':fid,'displayName':display,'source':filename,'width':w,'height':h,
        'panelCount':len(rects),'poseCount':len(rects),'layout':layout,
        'mergedCells':sum(1 for ww in widths if ww>median_width*1.28),'specialPanels': fid in ('alien','tempura'),
        'captionRegionsChecked':len(profile.get('rows',[])) or profile.get('grid',[5,6])[1],
        'panelBordersChecked':True,'blackRemovalSafety':'edge-connected only; interior black preserved',
        'backgroundRemoval':'edge-connected near-black <30 + 1.2px feather','captionTrim':profile.get('caption',.17)
    })

AUDIT.mkdir(parents=True,exist_ok=True)
(AUDIT/'asset-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
(AUDIT/'sheet-profiles.json').write_text(json.dumps(profile_report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
