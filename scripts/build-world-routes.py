"""Author shared-world exterior routes from the traced standard plan.

Requires numpy, opencv-python-headless, shapely (offline tools only).
Endpoints are public roadside meeting points, never indoor navigation.
"""
import heapq,json,math
from pathlib import Path
import cv2
import numpy as np
from shapely.geometry import Polygon,box,LineString
from shapely.ops import unary_union

root=Path(__file__).resolve().parents[1]
plan=json.loads((root/'lib/campus-plan.json').read_text(encoding='utf-8'))
places=json.loads((root/'lib/world-places.json').read_text(encoding='utf-8'))
roads=unary_union([Polygon(r['surface'][0],r['surface'][1:]) for r in plan['roads']])
obstacles=unary_union([Polygon(b['rings'][0],b['rings'][1:]).buffer(1.2) for b in plan['buildings']]+[Polygon(r).buffer(.8) for r in plan['hills']]+[box(632,805,716,900),box(876,727,946,789),box(848,626,868,688),box(954,626,974,688),box(864,603,958,630)])
walk=roads.buffer(1.8).difference(obstacles)
mask=np.zeros((1154,2048),np.uint8)
for p in (list(walk.geoms) if walk.geom_type=='MultiPolygon' else [walk]):
    if p.geom_type!='Polygon':continue
    cv2.fillPoly(mask,[np.round(p.exterior.coords).astype('int32')],1)
    for h in p.interiors:cv2.fillPoly(mask,[np.round(h.coords).astype('int32')],0)
_,labels,stats,_=cv2.connectedComponentsWithStats(mask,connectivity=4)
label=max(range(1,len(stats)),key=lambda i:stats[i,cv2.CC_STAT_AREA])
nodes=np.argwhere(labels==label)
def nearest(p):
    y,x=nodes[np.argmin(np.sum((nodes-np.array([p[1],p[0]]))**2,axis=1))]
    return int(x),int(y)
start=nearest([989,699])
heap=[(0,start)];cost={start:0};parent={}
while heap:
    distance,q=heapq.heappop(heap)
    if distance>cost[q]:continue
    for dx,dy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,-1),(-1,1),(1,-1)]:
        x,y=q[0]+dx,q[1]+dy
        if not(0<=x<2048 and 0<=y<1154 and labels[y,x]==label):continue
        if dx and dy and not(mask[q[1],x] and mask[y,q[0]]):continue
        new=distance+math.hypot(dx,dy)
        if new>=cost.get((x,y),float('inf')):continue
        cost[x,y]=new;parent[x,y]=q;heapq.heappush(heap,(new,(x,y)))
paths={};children={};anchors=set()
for key,place in places.items():
    end=nearest(place['point']) if key!='beida' else start
    assert math.dist(end,place['point'])<85 or key=='beida',(key,end,place['point'])
    anchors.add(end)
    points=[end]
    while points[-1]!=start:points.append(parent[points[-1]])
    points.reverse();paths[key]=points
    for a,b in zip(points,points[1:]):children.setdefault(a,set()).add(b)
result={}
for key,points in paths.items():
    keep=[points[0]]
    for i,p in enumerate(points[1:-1],1):
        a,b=points[i-1],points[i+1]
        if p in anchors or len(children.get(p,[]))>1 or (p[0]-a[0],p[1]-a[1])!=(b[0]-p[0],b[1]-p[1]):keep.append(p)
    if len(points)>1:keep.append(points[-1])
    route=[[911,699],[989,699],*map(list,keep)]
    # Preserve the three existing rendezvous positions if the connection is unobstructed.
    if key in ('library','riverside'):route.append(places[key]['point'])
    if key=='beida':route=[[911,699]]
    assert len(route)==1 or not LineString(route).intersects(obstacles.buffer(-.5)),key
    result[key]=route
    place=places[key];place['point']=route[-1]
(root/'lib/world-places.json').write_text(json.dumps(places,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(root/'lib/world-routes.json').write_text(json.dumps(result,separators=(',',':'))+'\n',encoding='utf-8')
print(f'PASS: {len(result)} public meeting points connected on traced roads; no building or hill crossings.')
