import * as THREE from 'three';
import { MAP_SCALE as S, mapPosition } from './campus-data.ts';

type Point = [number, number];
type MaterialName = 'brick' | 'stone' | 'roof' | 'glass' | 'red' | 'paving' | 'grass' | 'road' | 'walk' | 'water' | 'track' | 'white' | 'wood' | 'leaf' | 'leafLight' | 'leafDark';
const COLORS: Record<MaterialName, string> = { brick: '#a2aaa5', stone: '#d4d7cf', roof: '#626c66', glass: '#536b6d', red: '#853e40', paving: '#dee0d4', grass: '#a4b38b', road: '#bac3b6', walk: '#eeeedd', water: '#90b4b0', track: '#ae6e5e', white: '#eeeedd', wood: '#756f55', leaf: '#728b5b', leafLight: '#91a76d', leafDark: '#5e784f' };

function inside(x: number, y: number, points: Point[]) {
  let result = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) result = !result;
  }
  return result;
}

export function buildCampus() {
  const campus = new THREE.Group(); campus.name = '南京大学苏州校区';
  campus.userData = { source: '南京大学资产管理处苏州校区平面图，2026-08-25', accuracy: 'Map-derived horizontal layout; approximate building elevations and facades.' };
  const materials = Object.fromEntries(Object.entries(COLORS).map(([key, color]) => [key, new THREE.MeshStandardMaterial({ color, roughness: key === 'glass' ? .32 : key === 'water' ? .42 : .9, metalness: key === 'glass' ? .18 : 0 })])) as Record<MaterialName, THREE.MeshStandardMaterial>;
  const geometries = { box: new THREE.BoxGeometry(1, 1, 1), sphere: new THREE.IcosahedronGeometry(1, 2), cylinder: new THREE.CylinderGeometry(1, 1, 1, 8) };
  const batches = new Map<string, THREE.Matrix4[]>();
  const dummy = new THREE.Object3D();
  let seed = 417;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  function instance(shape: keyof typeof geometries, material: MaterialName, x: number, y: number, z: number, w: number, h: number, d: number, ry = 0, rz = 0) {
    dummy.position.set(x, y, z); dummy.rotation.set(0, ry, rz); dummy.scale.set(w, h, d); dummy.updateMatrix();
    const key = `${shape}:${material}`; if (!batches.has(key)) batches.set(key, []); batches.get(key)!.push(dummy.matrix.clone());
  }
  function box(px: number, py: number, w: number, d: number, h: number, material: MaterialName, base = .1, rotation = 0) {
    const [x, z] = mapPosition(px, py); instance('box', material, x, base + h / 2, z, w * S, h, d * S, rotation);
  }
  function shape(points: Point[], material: MaterialName, elevation = .05, name = '') {
    const outline = new THREE.Shape(points.map(([px, py]) => { const [x, z] = mapPosition(px, py); return new THREE.Vector2(x, -z); }));
    const geometry = new THREE.ShapeGeometry(outline); geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, materials[material]); mesh.position.y = elevation; mesh.receiveShadow = true; mesh.name = name; campus.add(mesh); return mesh;
  }
  function line(points: Point[], width: number, material: MaterialName, elevation = .12, smooth = true) {
    let path: THREE.Vector3[] = points.map(([px, py]) => { const [x, z] = mapPosition(px, py); return new THREE.Vector3(x, elevation, z); });
    if (smooth && path.length > 2) path = new THREE.CatmullRomCurve3(path, false, 'centripetal').getPoints(Math.max(16, points.length * 10));
    const vertices: number[] = [], indices: number[] = [];
    for (let i = 0; i < path.length; i++) {
      const t = path[Math.min(i + 1, path.length - 1)].clone().sub(path[Math.max(i - 1, 0)]).normalize();
      const dx = -t.z * width * S / 2, dz = t.x * width * S / 2;
      vertices.push(path[i].x + dx, elevation, path[i].z + dz, path[i].x - dx, elevation, path[i].z - dz);
      if (i < path.length - 1) { const a = i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, materials[material]); mesh.receiveShadow = true; campus.add(mesh);
  }
  function road(points: Point[], width = 11) { line(points, width + 7, 'walk', .09); line(points, width, 'road', .115); }
  function at(cx: number, cy: number, dx: number, dy: number, rotation: number): Point { return [cx + dx * Math.cos(rotation) + dy * Math.sin(rotation), cy - dx * Math.sin(rotation) + dy * Math.cos(rotation)]; }
  function block(cx: number, cy: number, w: number, d: number, floors = 4, rotation = 0, pitched = false, base = .2) {
    const height = floors * 1.25;
    box(cx, cy, w + 2, d + 2, .38, 'stone', base, rotation);
    box(cx, cy, w, d, height, 'brick', base + .35, rotation);
    for (let f = 0; f < floors; f++) {
      box(cx, cy, w + .55, d + .55, .10, 'stone', base + 1.25 * f + .45, rotation);
      for (let j = 0; j < Math.floor(w / 6); j++) {
        const dx = (j - (Math.floor(w / 6) - 1) / 2) * 6;
        for (const sign of [-1, 1]) {
          const [x, y] = at(cx, cy, dx, sign * (d / 2 + .12), rotation);
          box(x, y, 3.35, .32, .89, 'red', base + .62 + f * 1.25, rotation);
          const [gx, gy] = at(cx, cy, dx, sign * (d / 2 + .32), rotation);
          box(gx, gy, 2.55, .12, .68, 'glass', base + .70 + f * 1.25, rotation);
        }
      }
      for (let j = 0; j < Math.floor(d / 6); j++) {
        const dy = (j - (Math.floor(d / 6) - 1) / 2) * 6;
        for (const sign of [-1, 1]) {
          const [x, y] = at(cx, cy, sign * (w / 2 + .12), dy, rotation);
          box(x, y, .25, 3.1, .84, 'red', base + .65 + f * 1.25, rotation);
          const [gx, gy] = at(cx, cy, sign * (w / 2 + .3), dy, rotation);
          box(gx, gy, .12, 2.4, .65, 'glass', base + .73 + f * 1.25, rotation);
        }
      }
    }
    box(cx, cy, w + 2.2, d + 2.2, .28, 'stone', base + height + .35, rotation);
    box(cx, cy, w - 1, d - 1, .22, 'roof', base + height + .62, rotation);
    if (pitched) hipRoof(cx, cy, w + 4, d + 4, height + base + .84, 1.6, rotation);
  }
  function hipRoof(cx: number, cy: number, w: number, d: number, elevation: number, rise: number, rotation = 0) {
    const [x, z] = mapPosition(cx, cy), a = w * S / 2, b = d * S / 2;
    const vertices = [-a, 0, -b, a, 0, -b, a, 0, b, -a, 0, b, -Math.max(a - b, 0), rise, 0, Math.max(a - b, 0), rise, 0];
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex([0, 4, 5, 0, 5, 1, 1, 5, 2, 2, 5, 4, 2, 4, 3, 3, 4, 0]); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, materials.roof); mesh.position.set(x, elevation, z); mesh.rotation.y = rotation; mesh.castShadow = true; campus.add(mesh);
  }
  function court(cx: number, cy: number, w: number, d: number, floors = 4, rotation = 0, wing = 10) {
    box(cx, cy, w + 5, d + 5, .20, 'paving', .1, rotation);
    box(cx, cy, w - 2 * wing, d - 2 * wing, .08, 'grass', .32, rotation);
    for (const sign of [-1, 1]) {
      let p = at(cx, cy, 0, sign * (d - wing) / 2, rotation); block(p[0], p[1], w, wing, floors, rotation);
      p = at(cx, cy, sign * (w - wing) / 2, 0, rotation); block(p[0], p[1], wing, d - 2 * wing, floors, rotation);
    }
    for (const sign of [-1, 1]) { const p = at(cx, cy, sign * w / 5, 0, rotation); tree(p[0], p[1], 1.0, .34); }
  }
  function tree(px: number, py: number, size = 1, ground = .1) {
    const [x, z] = mapPosition(px, py); const h = (1.8 + rand() * .7) * size;
    instance('cylinder', 'wood', x, ground + h * .45, z, .12 * size, h * .9, .12 * size);
    const material: MaterialName = rand() < .3 ? 'leafLight' : rand() < .5 ? 'leafDark' : 'leaf';
    instance('sphere', material, x, ground + h * .95, z, h * .50, h * .66, h * .50, rand() * Math.PI);
    if (size > 1.3) instance('sphere', material, x + h * .3, ground + h * .85, z + h * .1, h * .40, h * .49, h * .4);
  }

  // The presentation plinth follows the campus extent, including its bordering streets.
  const boundary: Point[] = [[351,92],[450,63],[760,-12],[1045,-38],[1101,8],[1171,214],[1268,327],[1460,404],[1638,488],[1740,723],[1774,1054],[1650,1106],[975,1151],[535,1166],[357,1110],[330,968],[334,357]];
  const outline = new THREE.Shape(boundary.map(([px, py]) => { const [x, z] = mapPosition(px, py); return new THREE.Vector2(x, -z); }));
  const plinthGeo = new THREE.ExtrudeGeometry(outline, { depth: 4, bevelEnabled: true, bevelSize: 1.8, bevelThickness: 1.4, bevelSegments: 3, steps: 1 }); plinthGeo.rotateX(-Math.PI / 2);
  const plinth = new THREE.Mesh(plinthGeo, new THREE.MeshStandardMaterial({ color: '#dfe4d7', roughness: .95 })); plinth.position.y = -5.4; plinth.receiveShadow = true; plinth.castShadow = true; plinth.name = '校园底座'; campus.add(plinth);
  shape(boundary, 'grass', -.02);

  // Jiuqu River: eastern edge plus the northern tributary. Water is rendered as geometry, not a map image.
  const river: Point[] = [[1025,-37],[1100,-22],[1140,51],[1163,152],[1214,231],[1230,286],[1303,327],[1390,378],[1450,421],[1510,435],[1560,417],[1589,365],[1625,308],[1673,359],[1714,390],[1778,397],[1778,470],[1685,466],[1633,451],[1587,478],[1554,524],[1561,556],[1642,612],[1686,685],[1721,797],[1757,929],[1780,1048],[1731,1059],[1703,965],[1664,816],[1610,705],[1516,624],[1434,585],[1397,550],[1373,491],[1314,459],[1282,376],[1209,328],[1183,256],[1129,196],[1104,103],[1081,36]];
  shape(river, 'water', .025, '九曲河');
  line([[1052,-12],[971,7],[920,48],[868,103],[833,166],[800,210],[679,217],[486,219],[342,240]], 25, 'water', .027);
  line([[909,666],[839,731],[890,788],[927,875],[924,942],[901,973]], 51, 'water', .026);
  line([[338,219],[329,445],[330,729],[344,987],[337,1140]], 26, 'water', .024);

  const roads: Point[][] = [
    [[341,119],[542,87],[751,32],[944,-46]],
    [[361,78],[374,263],[362,574],[372,887],[372,1100]],
    [[356,1100],[654,1133],[992,1120],[1325,1091],[1739,1062]],
    [[404,157],[553,132],[740,105],[819,98]],
    [[404,157],[411,382],[408,554],[417,816],[419,1011],[449,1052],[670,1078],[852,1068],[902,1048]],
    [[550,143],[550,323],[547,551],[549,725],[549,894],[560,1058]],
    [[679,146],[678,307],[677,552]],
    [[408,554],[602,555],[813,556],[865,550]],
    [[417,722],[681,723],[844,723]],
    [[420,895],[682,895],[873,895]],
    [[673,711],[674,882],[673,1074]],
    [[838,105],[820,251],[858,400],[888,520],[960,618],[987,702],[963,797],[969,936],[943,1028],[902,1048]],
    [[911,107],[913,87],[966,48],[1039,23],[1086,44],[1117,154],[1161,252],[1213,328],[1284,482],[1373,658],[1427,735],[1433,865],[1487,926],[1530,1005],[1640,1011],[1705,984],[1665,825],[1627,705],[1514,657]],
    [[1000,551],[1140,572],[1199,538],[1291,496]],
    [[1212,319],[1311,457]],
    [[1278,482],[1392,641],[1514,657]],
    [[1452,698],[1541,679],[1613,714]],
    [[1432,865],[1556,890],[1638,875]],
    [[1482,929],[1483,980],[1530,1005]],
  ];
  roads.forEach((p, i) => road(p, i < 3 ? 17 : 8));
  // A pair of quiet bridge connections and the main southern entry.
  box(680,216,37,14,.8,'stone',.16); box(831,184,24,13,.7,'stone',.15,-.6);
  box(676,1083,42,12,.5,'stone',.1); box(407,555,24,20,.25,'paving',.12);

  const northHill: Point[] = [[864,121],[920,110],[1007,128],[1054,202],[1093,281],[1125,350],[1182,477],[1132,538],[1023,575],[950,547],[902,430],[863,355],[838,253],[841,183]];
  const southHill: Point[] = [[1010,584],[1113,583],[1184,558],[1244,598],[1323,730],[1381,872],[1393,929],[1435,1006],[1472,1030],[1459,1064],[950,1093],[950,1024],[971,956],[984,887],[979,800],[1004,725],[1005,658],[980,613]];
  function hillHeight(px: number, py: number) {
    const peak = (x: number, y: number, sx: number, sy: number, h: number) => h * Math.exp(-((px - x) ** 2 / (2 * sx * sx) + (py - y) ** 2 / (2 * sy * sy)));
    return peak(944,220,53,95,25) + peak(1061,437,59,70,28) + peak(1164,806,89,126,37) + peak(1252,939,64,68,9);
  }
  for (const border of [northHill, southHill]) {
    const minX = Math.min(...border.map(p => p[0])), maxX = Math.max(...border.map(p => p[0]));
    const minY = Math.min(...border.map(p => p[1])), maxY = Math.max(...border.map(p => p[1]));
    const vertices: number[] = [], colors: number[] = [], indices: number[] = [];
    const nx = 72, ny = 90;
    const low = new THREE.Color('#9fac82'), high = new THREE.Color('#879769');
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const px = minX + (maxX - minX) * i / nx, py = minY + (maxY - minY) * j / ny;
      const [x,z] = mapPosition(px,py); let h = hillHeight(px,py);
      let edge = 1000;
      for (let k=0; k<border.length; k++) {
        const a=border[k], b=border[(k+1)%border.length], vx=b[0]-a[0], vy=b[1]-a[1];
        const t=Math.max(0,Math.min(1,((px-a[0])*vx+(py-a[1])*vy)/(vx*vx+vy*vy)));
        edge=Math.min(edge, Math.hypot(px-a[0]-t*vx,py-a[1]-t*vy));
      }
      h *= Math.min(1,edge/18); h += .08;
      vertices.push(x,h,z); const color = low.clone().lerp(high,Math.min(1,h/40)); colors.push(color.r,color.g,color.b);
      if(i<nx && j<ny && inside(px+(maxX-minX)/nx*.5,py+(maxY-minY)/ny*.5,border)) { const a=j*(nx+1)+i; indices.push(a,a+nx+1,a+1,a+1,a+nx+1,a+nx+2); }
    }
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();
    const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1})); m.receiveShadow=true;m.castShadow=true;m.name='庄里山山体';campus.add(m);
    for(let i=0;i<1250;i++) {
      const px=minX+rand()*(maxX-minX),py=minY+rand()*(maxY-minY);
      if(!inside(px,py,border)||hillHeight(px,py)<3)continue;
      let edge=1000;
      for(let k=0;k<border.length;k++){const a=border[k],b=border[(k+1)%border.length],vx=b[0]-a[0],vy=b[1]-a[1];const t=Math.max(0,Math.min(1,((px-a[0])*vx+(py-a[1])*vy)/(vx*vx+vy*vy)));edge=Math.min(edge,Math.hypot(px-a[0]-t*vx,py-a[1]-t*vy));}
      tree(px,py,.8+rand()*.75,hillHeight(px,py)*Math.min(1,edge/18)+.08);
    }
  }
  // Thin walking paths rise with the terrain; no fictitious navigation routing is exposed.
  for (const path of [[[956,1030],[997,928],[1035,868],[1085,835],[1117,772],[1160,734],[1220,780],[1260,889],[1325,974]],[[862,275],[905,327],[985,349],[1040,415],[1081,477],[1125,493]]] as Point[][]) {
    const curve=new THREE.CatmullRomCurve3(path.map(([x,y])=>{const [wx,wz]=mapPosition(x,y);return new THREE.Vector3(wx,hillHeight(x,y)+.35,wz);}));
    const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,120,.20,4,false),materials.walk);mesh.receiveShadow=true;campus.add(mesh);
  }

  // West campus: research courtyards, teaching complex, living quarters.
  for (const [x,y,w,d,f] of [[478,604,78,45,5],[478,674,78,48,5],[608,604,76,44,5],[609,674,78,48,5],[490,837,98,78,5],[523,962,146,92,5],[803,966,118,108,6]] ) court(x,y,w,d,f);
  for (const [x,y,w,d,f] of [[493,168,99,25,7],[607,163,95,24,7],[720,167,59,27,7],[786,111,26,56,7],[749,256,97,20,7],[714,295,55,21,7],[810,315,37,28,7],[716,362,68,19,7],[719,410,56,49,7],[831,407,51,29,7],[831,475,75,25,7],[785,488,24,45,7],[725,512,43,46,3]]) block(x,y,w,d,f);
  block(724,597,78,25,5); block(724,691,78,25,5); block(747,644,25,70,4);
  const teachingArc:Point[]=[];for(let a=-1.1;a<1.15;a+=.1)teachingArc.push([811+28*Math.cos(a),644+35*Math.sin(a)]);line(teachingArc,12,'brick',7);
  for(let a=-1.1;a<1.15;a+=.18)block(811+28*Math.cos(a),644+35*Math.sin(a),7,12,5,-a);
  // Small public research terraces surrounding the library.
  for(const [x,y,w,d] of [[588,804,48,25],[590,874,48,27],[760,823,70,27],[763,875,66,26],[912,954,20,77]])block(x,y,w,d,4);

  // North Building: stone steps, symmetrical wings, pitched roofs and central tower.
  box(911,651,137,113,.24,'paving',.1);
  block(911,614,93,22,3,0,true);block(858,657,18,61,3,0,true);block(964,657,18,61,3,0,true);
  box(911,619,16,20,13,'brick',.2);box(911,630,9,.7,10.4,'glass',1.2);box(911,607,9,.7,8.7,'glass',2.2);
  box(911,619,21,25,.5,'roof',13.2);box(911,619,12,17,.5,'stone',13.7);
  for(let i=0;i<7;i++)box(911,684-i*3,57,4,.16*(i+1),'stone',.1);
  for(const x of [878,943]) {box(x,657,17,35,.12,'grass',.36);tree(x,654,1.15,.49);}
  for(const x of [886,936]){box(x,642,2,2,4.5,'stone',.1);box(x,642,5,5,.22,'stone',4.6);}
  // The auditorium on the same campus axis, beside the water.
  box(911,757,63,61,6.4,'brick',.2);hipRoof(911,757,70,68,6.6,2.8);box(911,789,40,4,3.6,'glass',.3);

  // Library reference: a square lantern with continuous horizontal fins and broad eaves.
  box(674,851,81,88,.45,'stone',.15);box(674,851,65,73,14,'glass',2.4);
  for(let i=0;i<18;i++)box(674,851,69,77,.14,'stone',3+i*.74);
  for(const dx of [-1,1])for(const dy of [-1,1])box(674+dx*32,851+dy*35,2,2,16,'brick',.5);
  box(674,890,18,1.2,12,'stone',3.4);box(674,890.9,5,.5,5.5,'brick',6.2);
  box(674,851,78,86,.32,'roof',16.5);hipRoof(674,851,82,90,16.85,1.5);
  for(let i=-3;i<=3;i++)for(const side of [-1,1])box(674+i*10,851+side*42,1.7,1.7,2.4,'brick',.3);
  box(674,851,52,60,.35,'stone',18.4);

  function oval(cx:number,cy:number,w:number,h:number,rotation:number):Point[]{
    const points:Point[]=[];const r=w/2,dy=(h-w)/2;
    for(let i=0;i<=24;i++){const a=Math.PI+i/24*Math.PI;points.push(at(cx,cy,Math.cos(a)*r,-dy+Math.sin(a)*r,rotation));}
    for(let i=0;i<=24;i++){const a=i/24*Math.PI;points.push(at(cx,cy,Math.cos(a)*r,dy+Math.sin(a)*r,rotation));}return points;
  }
  function field(cx:number,cy:number,w:number,h:number,rotation=0){
    shape(oval(cx,cy,w+6,h+6,rotation),'paving',.17);shape(oval(cx,cy,w,h,rotation),'track',.19);
    for(let lane=0;lane<5;lane++){const ring=oval(cx,cy,w-lane*3,h-lane*3,rotation);line([...ring,ring[0]],.35,'white',.21,false);}
    shape(oval(cx,cy,w-18,h-18,rotation),'grass',.22);
    const fw=w-27,fh=h-38;
    for(let i=0;i<8;i++){const [x,y]=at(cx,cy,0,-fh/2+fh/8*(i+.5),rotation);box(x,y,fw,fh/8,.016,i%2===0?'grass':'leafLight',.235,rotation);}
    const corners=[[-fw/2,-fh/2],[fw/2,-fh/2],[fw/2,fh/2],[-fw/2,fh/2],[-fw/2,-fh/2]].map(([x,y])=>at(cx,cy,x,y,rotation));line(corners,.5,'white',.26,false);
    line([at(cx,cy,-fw/2,0,rotation),at(cx,cy,fw/2,0,rotation)],.5,'white',.265,false);
    const circle:Point[]=[];for(let i=0;i<=48;i++)circle.push(at(cx,cy,Math.cos(i/48*Math.PI*2)*9,Math.sin(i/48*Math.PI*2)*9,rotation));line(circle,.5,'white',.265,false);
    for(const side of [-1,1]){
      const p=[[-fw*.31,side*fh/2],[-fw*.31,side*(fh/2-16)],[fw*.31,side*(fh/2-16)],[fw*.31,side*fh/2]].map(([x,y])=>at(cx,cy,x,y,rotation));line(p,.45,'white',.27,false);
      const [gx,gy]=at(cx,cy,0,side*(fh/2+1),rotation);box(gx,gy,12,1,1.8,'white',.28,rotation);
    }
    for(let row=0;row<5;row++){const [x,y]=at(cx,cy,-w/2-4-row*1.5,0,rotation);box(x,y,1.7,h*.65,.5+row*.35,'stone',.14,rotation);}
  }
  field(610,414,89,166);field(1336,562,92,159,.43);
  function basketball(cx:number,cy:number,rot=0){box(cx,cy,25,43,.10,'track',.15,rot);const p=[[-10,-19],[10,-19],[10,19],[-10,19],[-10,-19]].map(([x,y])=>at(cx,cy,x,y,rot));line(p,.35,'white',.27,false);line([at(cx,cy,-10,0,rot),at(cx,cy,10,0,rot)],.35,'white',.275,false);}
  for(let i=0;i<3;i++)for(let j=0;j<2;j++)basketball(571+i*26,271+j*45);
  for(let i=0;i<4;i++)basketball(568+i*25,520);
  for(let i=0;i<3;i++)for(let j=0;j<2;j++){const p=at(1401,677,(i-1)*27,(j-.5)*45,.43);basketball(p[0],p[1],.43);}
  // Sports centre: stepped silver folded roof and repeated angled red fins.
  box(482,414,97,126,6.4,'glass',.2);
  for(let i=0;i<29;i++){
    const y=355+i*4.2;const roofHeight=3.0+4.0*Math.sin(i/28*Math.PI);
    box(482,y,101,3.8,roofHeight,'stone',6.6);
    for(const side of [-1,1]){const [x,z]=mapPosition(482+side*50,y);instance('box','red',x,.2+3.5,z,.29,7,1.05,0,side*-.14);}
  }
  block(482,515,90,43,2);hipRoof(482,515,99,50,3.1,1.9);
  // Student activity centre: rounded petals around a central hall.
  box(484,280,80,89,5.2,'brick',.2);for(let i=0;i<4;i++){const a=i*Math.PI/2;box(484+Math.cos(a)*35,280+Math.sin(a)*36,30,36,4.6,'stone',.2,a);hipRoof(484+Math.cos(a)*35,280+Math.sin(a)*36,33,39,4.8,1.2,a);}hipRoof(484,280,66,70,5.4,2.4);

  // East campus residential buildings follow the arc between hill and river.
  for(const [x,y,w,d,rot] of [[949,74,45,14,-.6],[985,48,45,14,-.32],[1028,36,47,17,0],[1075,74,18,55,.2],[1095,126,18,58,.23],[1036,87,45,15,0],[1046,118,46,16,0],[1059,158,47,18,0]])block(x,y,w,d,8,rot);
  for(const [x,y]of [[1003,117],[1020,145],[1070,178],[971,95]])tree(x,y,1.5);
  block(1123,235,53,23,4,.48);block(1143,298,42,64,4,.47);
  for(let i=0;i<4;i++){const p=at(1106,201,(i-1.5)*10,0,.4);box(p[0],p[1],8,28,3.5,'stone',.2,.4);}
  // Nanyong: four staggered courts and a terraced planted central spine.
  const nRot=.46;
  for(const [dx,dy] of [[-32,-38],[33,-48],[-32,35],[33,23]]){const p=at(1253,409,dx,dy,nRot);court(p[0],p[1],50,57,4,nRot,9);}
  for(let i=0;i<8;i++){const p=at(1253,409,0,(i-3.5)*16,nRot);box(p[0],p[1],13,16,1.4+(3.5-Math.abs(i-3.5))*.72,'stone',.1,nRot);box(p[0],p[1],11,14,.18,'grass',1.5+(3.5-Math.abs(i-3.5))*.72,nRot);}
  for(const side of [-1,1])for(let i=0;i<10;i++){const p=at(1253,409,side*69,(i-4.5)*12,nRot);tree(p[0],p[1],.9);}
  // Zhiyuan living cluster, southeast of the running track.
  block(1435,602,51,18,6,-.45);block(1467,631,46,20,6,-.45);block(1476,597,19,43,6,-.45);
  // Science and innovation courts and their eastern curved research frontage.
  for(const [dx,dy]of [[-44,-48],[46,-48],[-44,45],[46,45]])court(1532+dx,793+dy,55,57,7,0,11);
  block(1532,785,144,13,3);box(1532,888,133,24,.3,'paving',.14);
  const arc:Point[]=[];for(let i=0;i<=20;i++){const a=-.75+i/20*1.5;arc.push([1571+69*Math.cos(a),793+83*Math.sin(a)]);}line(arc,12,'brick',10.8);line(arc,12.5,'stone',11.1);
  for(let i=0;i<14;i++){const a=-.72+i/13*1.44;block(1571+69*Math.cos(a),793+83*Math.sin(a),11,5,7,-a);}
  // International academic exchange centre, at the southeast edge.
  court(1576,955,84,65,4);block(1643,942,65,58,7);box(1643,942,73,63,.45,'stone',9.2);
  for(let i=0;i<7;i++)box(1643,942,68,60,.1,'roof',1.8+i*1.23);

  // Avenue trees are deterministic so the model is stable across reloads and exports.
  for(let y=165;y<1045;y+=19){tree(428,y,1.05);tree(537,y,1.0);}
  for(let x=446;x<890;x+=19){tree(x,738,1.1);tree(x,910,1.0);tree(x,1039,1.1);}
  for(let x=565;x<829;x+=18){tree(x,565,.9);tree(x,706,.9);}
  for(let i=0;i<64;i++){const t=i/63;const x=1190+475*t,y=323+650*t;tree(x+15*Math.sin(t*8),y,.95);}
  for(let i=0;i<38;i++){const x=1410+rand()*290,y=930+rand()*86;if(x>1510)tree(x,y,.85);}
  for(const [x,y] of [[913,686],[910,809],[754,758],[569,766],[1630,884],[1654,867],[695,745]]){box(x,y,15,15,.15,'paving',.1);tree(x,y,1.6);}
  // Benches, lamp poles and small garden furnishings make the close scenes legible.
  for(const [cx,cy] of [[910,658],[1252,409],[674,916],[1475,559],[1020,123]]){
    for(let i=0;i<4;i++){box(cx-18+i*12,cy+26,7,2,.5,'wood',.3);box(cx-18+i*12,cy+27,7,.5,.45,'wood',.8);}
    for(const side of [-1,1]){const [x,z]=mapPosition(cx+side*32,cy+15);instance('cylinder','roof',x,2.2,z,.08,4.4,.08);instance('sphere','white',x,4.5,z,.26,.16,.26);}
  }
  for (const [key, transforms] of batches) {
    const [kind, mat] = key.split(':') as [keyof typeof geometries, MaterialName];
    const mesh = new THREE.InstancedMesh(geometries[kind], materials[mat], transforms.length); transforms.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));
    mesh.name=`${kind}-${mat}`;mesh.castShadow=!['road','water','grass','paving','walk'].includes(mat);mesh.receiveShadow=true;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();campus.add(mesh);
  }
  return campus;
}
