"""Extract plan geometry from the user-supplied standard map (offline authoring only).

Usage: python scripts/trace-campus-plan.py SOURCE_PNG
Requires Pillow, numpy, opencv-python-headless and shapely. These are not site dependencies.
Coordinates remain in the existing 2048-wide drawing frame. Plan colors classify uses;
the 3D renderer retains the separate photo-referenced architectural palette.
"""
import hashlib, heapq, json, math, sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import Polygon, Point, LineString, box
from shapely.ops import unary_union
from shapely.geometry.polygon import orient

source = Path(sys.argv[1])
im = Image.open(source).convert('RGB')
im = im.resize((4096, round(im.height * 4096 / im.width)), Image.Resampling.LANCZOS)
pixels = np.asarray(im).astype(np.int16)

def outlines(color, bounds, minimum=20, holes_min=42, tolerance=.55, closing=3):
    mask = (np.linalg.norm(pixels - np.array(color), axis=2) < 32).astype('uint8') * 255
    x0,y0,x1,y1 = [round(v*2) for v in bounds]
    mask[:y0] = 0; mask[y1:] = 0; mask[:,:x0] = 0; mask[:,x1:] = 0
    # Join thin printed roof dividers without closing real courtyards or building gaps.
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((closing,closing),np.uint8))
    contours,hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None: return []
    result=[]
    for i,c in enumerate(contours):
        if hierarchy[0][i][3] != -1 or cv2.contourArea(c)/4 < minimum: continue
        shell = cv2.approxPolyDP(c,tolerance*2,True).reshape(-1,2)/2
        holes=[]; child=hierarchy[0][i][2]
        while child != -1:
            if cv2.contourArea(contours[child])/4 >= holes_min:
                holes.append(cv2.approxPolyDP(contours[child],tolerance*2,True).reshape(-1,2)/2)
            child=hierarchy[0][child][0]
        polygon=Polygon(shell,holes).buffer(0)
        parts=list(polygon.geoms) if polygon.geom_type=='MultiPolygon' else [polygon]
        result.extend(p for p in parts if p.area>=minimum)
    return sorted(result,key=lambda p:(p.centroid.y,p.centroid.x))

def rings(p):
    p=orient(p,sign=1.0)
    return [[[round(x,2),round(y,2)] for x,y in ring.coords[:-1]] for ring in [p.exterior,*p.interiors]]

groups=[
    ('west-research',(31,38,119),(423,576,939,1030),5,'brick','red'),
    ('west-residences',(190,103,0),(440,135,675,192),7,'residence','stone'),
    ('west-colleges',(190,103,0),(683,136,894,527),7,'residence','stone'),
    ('west-north-services',(203,163,0),(755,40,879,144),3,'brick','stone'),
    ('east-north-residences',(190,103,0),(906,20,1120,179),8,'residence','stone'),
    ('zhiyuan',(190,103,0),(1405,565,1510,671),6,'residence','stone'),
    ('west-teaching',(131,22,45),(680,578,835,710),5,'brick','redBright'),
    ('nanyong',(131,22,45),(1150,325,1343,494),5,'brick','redBright'),
    ('innovation',(31,38,119),(1410,703,1637,906),7,'brick','redBright'),
    ('west-dining',(203,163,0),(702,468,862,887),3,'stone','stone'),
    ('east-dining',(203,163,0),(1070,175,1156,273),3,'stone','stone'),
    ('east-administration',(157,137,187),(1105,210,1195,352),4,'brick','stone'),
    ('west-operations',(157,137,187),(619,245,658,322),4,'brick','stone'),
]
buildings=[]
for group,color,bounds,floors,facade,trim in groups:
    polygons=outlines(color,bounds,holes_min=220 if 'residences' in group or group=='zhiyuan' else 42)
    # Handwritten college labels are annotation, never courtyards or separate buildings.
    if 'residences' in group or group=='zhiyuan':
        combined=unary_union(polygons)
        polygons=list(combined.geoms) if combined.geom_type=='MultiPolygon' else [combined]
    for index,p in enumerate(polygons):
        # The three small service blocks at the north edge are low-rise; heights are inferred.
        if group=='west-colleges' and p.centroid.y>475 and p.centroid.x<750: continue
        core=p.buffer(-.8,join_style='mitre')
        if core.is_empty: continue
        cores=list(core.geoms) if core.geom_type=='MultiPolygon' else [core]
        buildings.append(dict(id=f'{group}-{index+1}',group=group,floors=floors,facade=facade,trim=trim,rings=rings(p),cores=[rings(c) for c in cores]))

clip=Polygon([[307,104],[760,-12],[1045,-38],[1135,-38],[1202,204],[1285,281],[1440,381],[1585,331],[1625,298],[1673,355],[1748,393],[1748,1118],[975,1151],[535,1166],[307,1110]])
water=[]
for p in outlines((112,200,212),(300,0,1748,1154),minimum=70,holes_min=200,tolerance=1.15):
    p=p.intersection(clip)
    for part in (list(p.geoms) if p.geom_type=='MultiPolygon' else [p]):
        if part.geom_type=='Polygon' and part.area>70: water.append(rings(part))

roads=[]
for p in outlines((113,113,113),(300,0,1748,1154),minimum=65,holes_min=24,tolerance=.65):
    p=p.intersection(clip)
    for part in (list(p.geoms) if p.geom_type=='MultiPolygon' else [p]):
        if part.geom_type=='Polygon' and part.area>65: roads.append(dict(surface=rings(part),edge=rings(part.buffer(1.8,join_style='round'))))

hills=[rings(p)[0] for p in outlines((77,108,41),(829,109,1475,1099),minimum=10000,holes_min=1000000,tolerance=1.3,closing=17)]
road_area=unary_union([Polygon(r['surface'][0],r['surface'][1:]) for r in roads])
obstacles=unary_union([Polygon(b['rings'][0],b['rings'][1:]).buffer(1.2) for b in buildings]+[Polygon(r).buffer(.8) for r in hills]+[box(632,805,716,900),box(876,727,946,789),box(848,626,868,688),box(954,626,974,688),box(864,603,958,630)])
walk=road_area.buffer(1.8).difference(obstacles)
walk_mask=np.zeros((1154,2048),np.uint8)
for p in (list(walk.geoms) if walk.geom_type=='MultiPolygon' else [walk]):
    if p.geom_type!='Polygon':continue
    cv2.fillPoly(walk_mask,[np.round(p.exterior.coords).astype('int32')],1)
    for h in p.interiors:cv2.fillPoly(walk_mask,[np.round(h.coords).astype('int32')],0)
_,labels,stats,_=cv2.connectedComponentsWithStats(walk_mask,connectivity=4)
components=[np.argwhere(labels==i) for i in range(1,len(stats)) if stats[i,cv2.CC_STAT_AREA]>250]
def route(start,end,entry=None):
    def nearest(p,nodes):
        y,x=nodes[np.argmin(np.sum((nodes-np.array([p[1],p[0]]))**2,axis=1))]
        return int(x),int(y)
    candidates=[]
    for nodes in components:
        a,b=nearest(entry or start,nodes),nearest(end,nodes)
        if LineString([start,*([entry] if entry else []),a]).intersects(obstacles) or LineString([end,b]).intersects(obstacles):continue
        candidates.append((math.dist(entry or start,a)+math.dist(end,b),a,b))
    assert candidates, 'No accessible mapped road entrances'
    distance,a,b=min(candidates);assert distance<170, 'Mapped road is too far from an activity point'
    heap=[(0,a)];cost={a:0.};parent={}
    while heap:
        _,q=heapq.heappop(heap)
        if q==b:break
        for dx,dy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,-1),(-1,1),(1,-1)]:
            x,y=q[0]+dx,q[1]+dy
            if not (0<=x<2048 and 0<=y<1154 and walk_mask[y,x]):continue
            if dx and dy and not (walk_mask[q[1],x] and walk_mask[y,q[0]]):continue
            new=cost[q]+math.hypot(dx,dy)
            if new>=cost.get((x,y),float('inf')):continue
            cost[x,y]=new;parent[x,y]=q;heapq.heappush(heap,(new+math.hypot(x-b[0],y-b[1]),(x,y)))
    assert b in parent, f'No mapped ground route between {start} and {end}'
    points=[b]
    while points[-1]!=a:points.append(parent[points[-1]])
    points.reverse()
    simple=cv2.approxPolyDP(np.array(points,dtype=np.float32),.65,False).reshape(-1,2).tolist()
    result=[start,*([entry] if entry else []),*simple,end]
    assert not LineString(result).intersects(obstacles.buffer(-.5)), 'A route crossed a building or hill'
    return result
paths={'libraryToBeida':route([674,906],[911,699]),'beidaToRiver':route([911,699],[1418,609],entry=[989,699])}
assert LineString(paths['beidaToRiver']).length<1400, 'Use the mapped internal east-west connection'
data=dict(source='User-provided NJU Suzhou standard plan, received 2026-09-09',sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),frameWidth=2048,buildings=buildings,water=water,roads=roads,hills=hills,boundary=rings(clip)[0],paths=paths)
Path('lib/campus-plan.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf8')
preview=im.resize((2048,round(im.height/2))).convert('RGBA')
overlay=Image.new('RGBA',preview.size); draw=ImageDraw.Draw(overlay)
for b in buildings:
    draw.polygon(b['rings'][0],fill=(0,218,255,95),outline=(0,75,100,255),width=1)
    for hole in b['rings'][1:]: draw.polygon(hole,fill=(255,255,255,130))
for points in paths.values():draw.line([tuple(p) for p in points],fill=(255,70,0,255),width=3)
preview=Image.alpha_composite(preview,overlay)
Path('outputs/standard-map-reference').mkdir(exist_ok=True)
preview.save('outputs/standard-map-reference/footprints-overlay.png')
print(json.dumps({'buildings':len(buildings),'waterBodies':len(water),'roads':len(roads),'hills':len(hills),'groups':{g[0]:sum(b['group']==g[0] for b in buildings) for g in groups}}))
