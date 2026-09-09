import * as THREE from 'three';
import { MAP_SCALE as S, mapPosition } from './campus-data.ts';

type Point = [number, number];
type MaterialName = 'brick' | 'stone' | 'roof' | 'roofFlat' | 'glass' | 'glassLight' | 'glassShade' | 'interior' | 'red' | 'redBright' | 'paving' | 'grass' | 'road' | 'walk' | 'water' | 'track' | 'trackPurple' | 'trackBlue' | 'courtBlue' | 'turf' | 'turfLight' | 'white' | 'wood' | 'leaf' | 'leafLight' | 'leafDark' | 'metal' | 'frame' | 'residence' | 'residenceShade';
export const CAMPUS_COLORS: Record<MaterialName, string> = {
  brick: '#a4a7a3', stone: '#c9cbc6', roof: '#50595e', roofFlat: '#738187',
  glass: '#36575f', glassLight: '#4e6a71', glassShade: '#2c444c', interior: '#1f2b2f', red: '#963e37', redBright: '#b1342e',
  paving: '#bec3bd', grass: '#87966b', road: '#535d62', walk: '#cfd2ca', water: '#527a7d',
  track: '#a65749', trackPurple: '#7650cf', trackBlue: '#1385c3', courtBlue: '#4a94be', turf: '#287545', turfLight: '#398651',
  white: '#f2f0e8', wood: '#645344', leaf: '#4d6d3e', leafLight: '#6e8549', leafDark: '#395939',
  metal: '#bfc8cb', frame: '#37454b', residence: '#c7c1bb', residenceShade: '#a9a6a2',
};

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
  campus.userData = {
    source: '南京大学资产管理处苏州校区平面图，2026-08-25；南京大学东区 2023 / 西区 2025 实景；中衡设计建成项目图纸；用户提供的西区紫色跑道照片',
    accuracy: 'Photo-referenced reconstruction, not a surveyed as-built twin. West track is purple per the user\'s location-confirmed photograph. Heights, unseen elevations and roof equipment remain approximate.',
    references: ['https://ltx.nju.edu.cn/yfsh/sy/jsnltzsyzpjj/20251205/i353895.html','https://ltx.nju.edu.cn/yfsh/sy/jsnltzsyzpjj/20231222/i256558.html','https://www.artsgroup.cn/zhonghengdongtai/shejiqushi/2023-12-29/558.html'],
  };
  const materials = Object.fromEntries(Object.entries(CAMPUS_COLORS).map(([key, color]) => {
    const glass=key.startsWith('glass');
    const material = new THREE.MeshStandardMaterial({ color, roughness: glass ? .24 : key === 'water' ? .22 : key === 'metal' ? .42 : key === 'roofFlat' ? .72 : .92, metalness: glass ? .32 : key === 'metal' ? .55 : key === 'water' ? .12 : 0 });
    material.name = key; material.envMapIntensity = glass ? 1.1 : key === 'water' ? .7 : .28;
    return [key, material];
  })) as Record<MaterialName, THREE.MeshStandardMaterial>;
  const geometries = { box: new THREE.BoxGeometry(1, 1, 1), sphere: new THREE.SphereGeometry(1, 10, 8), cylinder: new THREE.CylinderGeometry(1, 1, 1, 8) };
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
  function block(cx: number, cy: number, w: number, d: number, floors = 4, rotation = 0, pitched = false, base = .2, facade: MaterialName = 'brick', trim: MaterialName = 'red') {
    const height = floors * 1.25;
    box(cx, cy, w + 2, d + 2, .38, 'stone', base, rotation);
    // The facade is assembled around real openings: glazing sits behind the piers and lintels.
    // A recessed dark core closes the envelope without pretending to model interiors.
    box(cx,cy,w-2.4,d-2.4,height,'interior',base+.35,rotation);
    for(const side of [0,1,2,3]) {
      const faceRotation=rotation+side*Math.PI/2,length=side%2?d:w,depth=side%2?w:d;
      const center=at(cx,cy,0,depth/2-.5,faceRotation);
      const columns=Math.max(1,Math.floor(length/6)),bay=length/columns,opening=Math.min(4.1,bay-1.3);
      const panel=(u:number,out:number,width:number,thickness:number,h:number,mat:MaterialName,y:number)=>{
        const p=at(center[0],center[1],u,out,faceRotation);box(p[0],p[1],width,thickness,h,mat,y,faceRotation);
      };
      for(let j=0;j<=columns;j++) {
        const end=j===0||j===columns,pier=(bay-opening)*(end ? .5 : 1);
        const u=-length/2+j*bay+(j===0?pier/2:j===columns?-pier/2:0);
        panel(u,0,pier,1,height,facade,base+.35);
      }
      for(let f=0;f<floors;f++) {
        const floorY=base+.35+f*1.25,windowY=floorY+.24;
        panel(0,0,length,1,.24,facade,floorY);
        panel(0,0,length,1,.13,facade,floorY+1.12);
        if(facade!=='residence')panel(0,.18,length+.2,1.3,.055,'stone',floorY+.015);
        for(let j=0;j<columns;j++) {
          const u=-length/2+(j+.5)*bay;
          const pane:MaterialName=(j*7+f*3+side)%7===0?'glassLight':(j+f*5+side)%6===0?'glassShade':'glass';
          panel(u,-.22,opening,.12,.88,pane,windowY);
          for(const sign of [-1,1])panel(u+sign*(opening/2-.09),.13,.18,.7,.88,trim,windowY);
          panel(u,.13,opening,.7,.055,trim,windowY+.825);
          panel(u,.13,opening,.7,.055,trim,windowY);
          panel(u,-.10,.12,.13,.78,'frame',windowY+.05);
          panel(u,-.10,opening-.25,.13,.035,'frame',windowY+.58);
          panel(u,.34,opening+.45,1.45,.075,'stone',windowY-.04);
          if(facade==='residence'&&(j+f)%3===0)panel(u,.51,bay-.08,.09,.2,'residenceShade',floorY+.01);
        }
      }
    }
    const roofY=base+height+.35;
    box(cx,cy,w+.8,d+.8,.18,'stone',roofY,rotation);
    box(cx,cy,w-1.7,d-1.7,.12,pitched?'roof':'roofFlat',roofY+.18,rotation);
    if (pitched) hipRoof(cx, cy, w + 4, d + 4, roofY+.45, 1.6, rotation);
    else {
      for(const side of [0,1,2,3]) {
        const r=rotation+side*Math.PI/2,length=side%2?d:w,depth=side%2?w:d,p=at(cx,cy,0,depth/2-.35,r);
        box(p[0],p[1],length,.7,.35,facade,roofY+.18,r);
        box(p[0],p[1],length+.4,1.05,.07,'stone',roofY+.53,r);
      }
      // ponytail: schematic service details, not surveyed rooftop equipment locations.
      if(w>=26&&d>=12&&floors>=4) {
        const p=at(cx,cy,-w*.22,0,rotation);
        box(p[0],p[1],4,3.5,.34,'stone',roofY+.3,rotation);
        box(p[0],p[1],4.5,4,.08,'metal',roofY+.64,rotation);
        const vent=at(cx,cy,w*.25,0,rotation);
        box(vent[0],vent[1],2,2,.3,'frame',roofY+.3,rotation);
        box(vent[0],vent[1],2.7,2.7,.07,'metal',roofY+.6,rotation);
      }
    }
  }
  function hipRoof(cx: number, cy: number, w: number, d: number, elevation: number, rise: number, rotation = 0) {
    const [x, z] = mapPosition(cx, cy), a = Math.max(w,d) * S / 2, b = Math.min(w,d) * S / 2;
    const vertices = [-a, 0, -b, a, 0, -b, a, 0, b, -a, 0, b, -Math.max(a - b, 0), rise, 0, Math.max(a - b, 0), rise, 0];
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex([0, 4, 5, 0, 5, 1, 1, 5, 2, 2, 5, 4, 2, 4, 3, 3, 4, 0]); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, materials.roof); mesh.position.set(x, elevation, z); mesh.rotation.y = rotation + (d>w?Math.PI/2:0); mesh.castShadow = true; mesh.receiveShadow=true; campus.add(mesh);
    // Ridges and eave fascias remain geometry in the downloadable model.
    const roofRotation=rotation+(d>w?Math.PI/2:0);
    box(cx,cy,Math.max(w,d)-Math.min(w,d),.7,.15,'roof',elevation+rise,roofRotation);
    for(const sign of [-1,1]) {
      const p=at(cx,cy,0,sign*(Math.min(w,d)/2),roofRotation);
      box(p[0],p[1],Math.max(w,d),.9,.16,'roof',elevation-.08,roofRotation);
    }
  }
  function roofThickness(surface:THREE.Mesh,depth:number,edgeMaterial:MaterialName='metal') {
    const position=surface.geometry.getAttribute('position'),index=surface.geometry.getIndex()!;
    const vertices:number[]=[],indices:number[]=[],edges=new Map<string,[number,number,number]>();
    for(let i=0;i<position.count;i++)vertices.push(position.getX(i),position.getY(i)-depth,position.getZ(i));
    for(let i=0;i<index.count;i+=3) {
      const a=index.getX(i),b=index.getX(i+1),c=index.getX(i+2);indices.push(c,b,a);
      for(const [u,v] of [[a,b],[b,c],[c,a]]) {
        const key=`${Math.min(u,v)}:${Math.max(u,v)}`,edge=edges.get(key);
        if(edge)edge[2]++;else edges.set(key,[u,v,1]);
      }
    }
    for(const [a,b,count] of edges.values()) {
      if(count!==1)continue;
      const n=vertices.length/3;
      for(const [vertex,offset] of [[a,0],[b,0],[a,-depth],[b,-depth]])vertices.push(position.getX(vertex),position.getY(vertex)+offset,position.getZ(vertex));
      indices.push(n,n+2,n+1,n+1,n+2,n+3);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    const shell=new THREE.Mesh(geometry,materials[edgeMaterial]);shell.name=`${surface.name}厚边与檐底`;
    shell.castShadow=true;shell.receiveShadow=true;campus.add(shell);
  }
  function curtainWall(cx:number,cy:number,width:number,height:number,base:number,rotation=0) {
    const columns=Math.max(2,Math.round(width/5)),rows=Math.max(1,Math.round(height/1.3)),bay=width/columns,storey=height/rows;
    for(let col=0;col<columns;col++)for(let row=0;row<rows;row++) {
      const p=at(cx,cy,-width/2+(col+.5)*bay,0,rotation);
      const material:MaterialName=col%5===0?'glassShade':(col+row*2)%7===0?'glassLight':'glass';
      box(p[0],p[1],bay-.12,.12,storey-.035,material,base+row*storey,rotation);
    }
    for(let col=0;col<=columns;col++) {
      const p=at(cx,cy,-width/2+col*bay,.2,rotation);box(p[0],p[1],.16,.6,height,'frame',base,rotation);
    }
    for(let row=0;row<=rows;row++)box(cx,cy,width,.45,.045,'frame',base+row*storey,rotation);
  }
  function court(cx: number, cy: number, w: number, d: number, floors = 4, rotation = 0, wing = 10, trim:MaterialName='red') {
    box(cx, cy, w + 5, d + 5, .20, 'paving', .1, rotation);
    box(cx, cy, w - 2 * wing, d - 2 * wing, .08, 'grass', .32, rotation);
    for (const sign of [-1, 1]) {
      let p = at(cx, cy, 0, sign * (d - wing) / 2, rotation); block(p[0], p[1], w, wing, floors, rotation,false,.2,'brick',trim);
      p = at(cx, cy, sign * (w - wing) / 2, 0, rotation); block(p[0], p[1], wing, d - 2 * wing, floors, rotation,false,.2,'brick',trim);
    }
    for (const sign of [-1, 1]) { const p = at(cx, cy, sign * w / 5, 0, rotation); tree(p[0], p[1], 1.0, .34); }
  }
  function tree(px: number, py: number, size = 1, ground = .1) {
    const [x, z] = mapPosition(px, py); const h = (1.8 + rand() * .7) * size;
    instance('cylinder', 'wood', x, ground + h * .45, z, .12 * size, h * .9, .12 * size);
    const material: MaterialName = rand() < .3 ? 'leafLight' : rand() < .5 ? 'leafDark' : 'leaf';
    instance('sphere', material, x, ground + h * .95, z, h * .44, h * .57, h * .44, rand() * Math.PI);
    for(let crown=0;crown<3;crown++) {
      const angle=rand()*Math.PI*2,offset=h*(.16+rand()*.15);
      instance('sphere', crown===1?'leafDark':material, x+Math.cos(angle)*offset, ground+h*(.77+rand()*.3), z+Math.sin(angle)*offset, h*.30,h*.35,h*.30,angle);
    }
  }

  function beam(a: THREE.Vector3,b: THREE.Vector3,radius:number,material:MaterialName='metal') {
    dummy.position.copy(a).add(b).multiplyScalar(.5);
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());
    dummy.scale.set(radius,a.distanceTo(b),radius);dummy.updateMatrix();
    const key=`cylinder:${material}`;if(!batches.has(key))batches.set(key,[]);batches.get(key)!.push(dummy.matrix.clone());
  }
  function worldAt(cx:number,cy:number,dx:number,dy:number,h:number,rotation=0) {
    const p=at(cx,cy,dx,dy,rotation),[x,z]=mapPosition(p[0],p[1]);return new THREE.Vector3(x,h,z);
  }
  function rail(cx:number,cy:number,w:number,d:number,base:number,rotation=0) {
    for(const sign of [-1,1]) {
      beam(worldAt(cx,cy,-w/2,sign*d/2,base+.65,rotation),worldAt(cx,cy,w/2,sign*d/2,base+.65,rotation),.028);
      for(let x=-w/2;x<=w/2;x+=5) beam(worldAt(cx,cy,x,sign*d/2,base,rotation),worldAt(cx,cy,x,sign*d/2,base+.65,rotation),.023);
    }
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
    const low = new THREE.Color('#7c8956'), high = new THREE.Color('#607645');
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

  // North Building: the Suzhou building, not the ivy-covered Gulou original.
  box(911,651,137,113,.24,'paving',.1);
  block(911,614,93,22,3,0,true);block(858,657,18,61,3,0,true);block(964,657,18,61,3,0,true);
  box(911,619,16,20,10.6,'brick',.2);
  for(const side of [-1,1]) {
    const y=619+side*10.2;
    box(911,y,10,.5,5,'frame',5.2);box(911,y+side*.3,8.8,.18,4.65,'glass',5.35);
    for(const x of [-3,0,3])box(911+x,y+side*.45,.25,.15,4.7,'frame',5.32);
    for(let h=5.4;h<10;h+=1.15)box(911,y+side*.45,9,.15,.09,'frame',h);
    box(911,y+side*.4,11.4,1,.22,'stone',5.0);
  }
  box(911,619,21,25,.35,'stone',10.8);box(911,619,22,26,.23,'roof',11.15);
  hipRoof(911,619,18,22,11.4,1.2);
  for(const side of [-1,1])for(let x=874;x<953;x+=7){box(x,619+side*8,1.2,1.2,1.6,'stone',.4);box(x,619+side*8,2,2,.17,'stone',1.9);}
  box(911,630,14,3,2.3,'frame',.4);box(911,632,12,.35,2,'glass',.5);
  box(911,634,18,7,.18,'stone',2.75);
  for(let i=0;i<7;i++)box(911,684-i*3,57,4,.16*(i+1),'stone',.1);
  for(const x of [878,943]) {box(x,657,17,35,.12,'grass',.36);tree(x,654,1.15,.49);}
  for(const x of [886,936]){box(x,642,2,2,4.5,'stone',.1);box(x,642,5,5,.22,'stone',4.6);}
  // The auditorium on the same campus axis, beside the water.
  box(911,757,63,61,6.4,'brick',.2);hipRoof(911,757,70,68,6.6,2.8);box(911,789,40,4,3.6,'glass',.3);

  // West library: two-storey colonnade, paired horizontal fins, square glazed front and lifting eaves.
  box(674,851,81,88,.45,'stone',.15);box(674,851,64,73,4.1,'glass',.6);
  box(674,851,77,85,.5,'stone',4.65);box(674,851,67,75,10.7,'glass',5.15);
  for(const side of [0,1,2,3]) {
    const r=side*Math.PI/2,p=at(674,851,0,(side%2?67:75)/2+.08,r);
    curtainWall(p[0],p[1],side%2?75:67,10.7,5.15,r);
    const ground=at(674,851,0,(side%2?64:73)/2+.08,r);
    curtainWall(ground[0],ground[1],side%2?73:64,4.1,.6,r);
  }
  rail(674,851,77,84,4.95);
  for(let i=-4;i<=4;i++)for(const side of [-1,1]){
    box(674+i*8.5,851+side*41,1.7,1.7,4.1,'stone',.6);
    box(674+side*37,851+i*9,1.7,1.7,4.1,'stone',.6);
  }
  for(let floor=0;floor<6;floor++)for(const offset of [0,.27,.53]) {
    const level=5.3+floor*1.72+offset;
    box(674,851,71,79,.10,'metal',level);
  }
  for(const side of [-1,1])for(let i=-5;i<=5;i++){
    box(674+i*6,851+side*37.6,.28,.3,10.6,'frame',5.2);
    box(674+side*33.6,851+i*7,.3,.28,10.6,'frame',5.2);
  }
  for(const dx of [-1,1])for(const dy of [-1,1])box(674+dx*34,851+dy*38,1.3,1.3,11,'stone',5);
  // The photographed large square panel is glazed, not an opaque slab.
  box(674,891.2,28,1.6,8.5,'frame',6);box(674,892.1,25.5,.25,7.9,'glass',6.3);
  for(let i=-2;i<=2;i++)box(674+i*5.1,892.35,.2,.15,7.9,'metal',6.3);
  for(let h=6.3;h<14.3;h+=1.32)box(674,892.35,25.5,.15,.075,'metal',h);
  box(674,851,80,88,.26,'roofFlat',16.1);
  const eaveVertices:number[]=[],eaveIndices:number[]=[];
  for(let j=0;j<=16;j++)for(let i=0;i<=16;i++){
    const u=(i/16-.5)*2,v=(j/16-.5)*2,[x,z]=mapPosition(674+u*42,851+v*46);
    eaveVertices.push(x,16.55+.75*Math.pow(Math.max(Math.abs(u),Math.abs(v)),6),z);
    if(i<16&&j<16){const a=j*17+i;eaveIndices.push(a,a+17,a+1,a+1,a+17,a+18);}
  }
  const eaveGeo=new THREE.BufferGeometry();eaveGeo.setAttribute('position',new THREE.Float32BufferAttribute(eaveVertices,3));eaveGeo.setIndex(eaveIndices);eaveGeo.computeVertexNormals();
  const eaves=new THREE.Mesh(eaveGeo,materials.roofFlat);eaves.name='图书馆飞檐';eaves.castShadow=true;eaves.receiveShadow=true;campus.add(eaves);roofThickness(eaves,.23,'stone');
  box(674,851,47,55,.8,'stone',16.6);box(674,851,49,57,.14,'roofFlat',17.4);
  for(const x of [-14,0,14]) {
    box(674+x,851,7,10,.24,'frame',17.56);box(674+x,851,6.3,9.3,.09,'metal',17.8);
    for(let louver=0;louver<6;louver++)box(674+x,847+louver*1.5,6,.26,.055,'frame',17.89);
  }
  for(let i=0;i<7;i++)box(674,900-i*1.35,34,1.5,.09*(i+1),'stone',.12);

  function oval(cx:number,cy:number,w:number,h:number,rotation:number):Point[]{
    const points:Point[]=[];const r=w/2,dy=(h-w)/2;
    for(let i=0;i<=48;i++){const a=Math.PI+i/48*Math.PI;points.push(at(cx,cy,Math.cos(a)*r,-dy+Math.sin(a)*r,rotation));}
    for(let i=0;i<=48;i++){const a=i/48*Math.PI;points.push(at(cx,cy,Math.cos(a)*r,dy+Math.sin(a)*r,rotation));}return points;
  }
  function field(cx:number,cy:number,w:number,h:number,rotation=0,surface:MaterialName='trackPurple'){
    shape(oval(cx,cy,w+6,h+6,rotation),'paving',.17);shape(oval(cx,cy,w,h,rotation),surface,.19,surface==='trackBlue'?'东区蓝色跑道':'西区紫色跑道');
    for(let lane=0;lane<=8;lane++){const ring=oval(cx,cy,w-lane*2.5,h-lane*2.5,rotation);line([...ring,ring[0]],.18,'white',.214,false);}
    shape(oval(cx,cy,w-20.5,h-20.5,rotation),'turf',.22);
    const fw=w-35,fh=h-62;
    for(let i=0;i<10;i++){const [x,y]=at(cx,cy,0,-fh/2+fh/10*(i+.5),rotation);box(x,y,fw,fh/10,.012,i%2===0?'turf':'turfLight',.235,rotation);}
    const corners=[[-fw/2,-fh/2],[fw/2,-fh/2],[fw/2,fh/2],[-fw/2,fh/2],[-fw/2,-fh/2]].map(([x,y])=>at(cx,cy,x,y,rotation));line(corners,.5,'white',.26,false);
    line([at(cx,cy,-fw/2,0,rotation),at(cx,cy,fw/2,0,rotation)],.5,'white',.265,false);
    const circle:Point[]=[];for(let i=0;i<=48;i++)circle.push(at(cx,cy,Math.cos(i/48*Math.PI*2)*9,Math.sin(i/48*Math.PI*2)*9,rotation));line(circle,.5,'white',.265,false);
    for(const side of [-1,1]){
      const p=[[-fw*.31,side*fh/2],[-fw*.31,side*(fh/2-16)],[fw*.31,side*(fh/2-16)],[fw*.31,side*fh/2]].map(([x,y])=>at(cx,cy,x,y,rotation));line(p,.45,'white',.27,false);
      const goalY=side*fh/2,depth=side*3.2;
      for(const sign of [-1,1]) {
        beam(worldAt(cx,cy,sign*5.2,goalY,.28,rotation),worldAt(cx,cy,sign*5.2,goalY,1.4,rotation),.042,'white');
        beam(worldAt(cx,cy,sign*5.2,goalY,1.4,rotation),worldAt(cx,cy,sign*5.2,goalY+depth,.28,rotation),.025,'white');
      }
      beam(worldAt(cx,cy,-5.2,goalY,1.4,rotation),worldAt(cx,cy,5.2,goalY,1.4,rotation),.042,'white');
      for(let x=-5.2;x<=5.21;x+=1.04)beam(worldAt(cx,cy,x,goalY,1.4,rotation),worldAt(cx,cy,x,goalY+depth,.28,rotation),.009,'white');
      for(let row=0;row<=5;row++){const t=row/5;beam(worldAt(cx,cy,-5.2,goalY+depth*t,1.4-1.12*t,rotation),worldAt(cx,cy,5.2,goalY+depth*t,1.4-1.12*t,rotation),.009,'white');}
      const small=[[-fw*.15,side*fh/2],[-fw*.15,side*(fh/2-5.5)],[fw*.15,side*(fh/2-5.5)],[fw*.15,side*fh/2]].map(([x,y])=>at(cx,cy,x,y,rotation));line(small,.3,'white',.275,false);
    }
    // Staggered start marks on the straight. The lane surface remains blue in the east.
    for(let lane=0;lane<8;lane++){const x=w/2-(lane+.5)*1.25;line([at(cx,cy,x-.54,(h-w)/2-4-lane*.6,rotation),at(cx,cy,x+.54,(h-w)/2-4-lane*.6,rotation)],.22,'white',.218,false);}
    for(let row=0;row<7;row++){const [x,y]=at(cx,cy,-w/2-4-row*1.5,0,rotation);box(x,y,1.7,h*.65,.3+row*.22,'stone',.14,rotation);}
    const fence=oval(cx,cy,w+9,h+9,rotation);for(let i=0;i<fence.length;i+=3){const [x,z]=mapPosition(...fence[i]),[nx,nz]=mapPosition(...fence[(i+3)%fence.length]);beam(new THREE.Vector3(x,.2,z),new THREE.Vector3(x,1.4,z),.022,'frame');beam(new THREE.Vector3(x,1.35,z),new THREE.Vector3(nx,1.35,nz),.017,'frame');}
    for(const x of [-1,1])for(const y of [-1,1]){
      const position=worldAt(cx,cy,x*(w/2+9),y*h*.32,.2,rotation),top=position.clone().setY(7.1);beam(position,top,.065,'metal');
      const p=at(cx,cy,x*(w/2+9),y*h*.32,rotation);box(p[0],p[1],3,.8,.3,'frame',7.1,rotation);box(p[0],p[1]-.4,2.5,.15,.22,'white',7.13,rotation);
    }
  }
  field(610,414,89,166);field(1336,562,92,159,.43,'trackBlue');
  function basketball(cx:number,cy:number,rot=0,surface:MaterialName='track'){
    box(cx,cy,25,43,.10,surface,.15,rot);
    const p=[[-10,-19],[10,-19],[10,19],[-10,19],[-10,-19]].map(([x,y])=>at(cx,cy,x,y,rot));line(p,.25,'white',.27,false);line([at(cx,cy,-10,0,rot),at(cx,cy,10,0,rot)],.25,'white',.275,false);
    const circle:Point[]=[];for(let i=0;i<=40;i++)circle.push(at(cx,cy,Math.cos(i/40*Math.PI*2)*3,Math.sin(i/40*Math.PI*2)*3,rot));line(circle,.22,'white',.28,false);
    for(const sign of [-1,1]) {
      const key=[[-3.2,sign*19],[-3.2,sign*11],[3.2,sign*11],[3.2,sign*19]].map(([x,y])=>at(cx,cy,x,y,rot));line(key,.22,'white',.28,false);
      const p=at(cx,cy,0,sign*20,rot);box(p[0],p[1],.35,.35,1.35,'frame',.27,rot);
      const board=at(cx,cy,0,sign*18.5,rot);box(board[0],board[1],2.9,.18,.63,'white',1.35,rot);
    }
  }
  for(let i=0;i<3;i++)for(let j=0;j<2;j++)basketball(571+i*26,271+j*45);
  for(let i=0;i<4;i++)basketball(568+i*25,520);
  for(let i=0;i<3;i++)for(let j=0;j<2;j++){const p=at(1401,677,(i-1)*27,(j-.5)*45,.43);basketball(p[0],p[1],.43,'courtBlue');}
  // West sports centre: a continuous silver sail, rising ends and closely spaced vertical ribs.
  box(482,414,101,129,.38,'stone',.18);box(482,414,94,121,3,'glass',.58);
  const sailVertices:number[]=[],sailIndices:number[]=[];
  const sailHeight=(t:number)=>7.1+5.5*Math.pow(Math.abs(t*2-1),1.7);
  for(let j=0;j<=40;j++)for(let i=0;i<=12;i++){
    const u=i/12*2-1,t=j/40,[x,z]=mapPosition(482+u*50,351+t*126);
    sailVertices.push(x,sailHeight(t)+.6*(1-u*u),z);
    if(i<12&&j<40){const a=j*13+i;sailIndices.push(a,a+13,a+1,a+1,a+13,a+14);}
  }
  const sailGeo=new THREE.BufferGeometry();sailGeo.setAttribute('position',new THREE.Float32BufferAttribute(sailVertices,3));sailGeo.setIndex(sailIndices);sailGeo.computeVertexNormals();
  const sail=new THREE.Mesh(sailGeo,materials.metal);sail.name='西区文体中心银色风帆屋面';sail.castShadow=true;sail.receiveShadow=true;campus.add(sail);roofThickness(sail,.3);
  for(let rib=0;rib<=20;rib++) {
    const u=rib/20*2-1;
    for(let j=0;j<40;j++) {
      const a=worldAt(482,351,u*50,j/40*126,sailHeight(j/40)+.6*(1-u*u)+.045);
      const b=worldAt(482,351,u*50,(j+1)/40*126,sailHeight((j+1)/40)+.6*(1-u*u)+.045);
      beam(a,b,.025,'metal');
    }
  }
  for(let i=0;i<40;i++){
    const t=(i+.5)/40,y=351+t*126,h=sailHeight(t);
    for(const side of [-1,1]){
      box(482+side*46.5,y,1.3,3.15,h-3.2,'glass',3.2);
      box(482+side*48.3,y,2.8,.65,h-3.3,'metal',3.3);
      box(482+side*49,y,3.8,.28,.22,'metal',h-.1);
    }
  }
  for(const y of [351,477]){
    box(482,y,91,1,9.2,'glass',3.2);box(482,y,99,2,.32,'metal',12.4);
    for(let x=438;x<529;x+=6)box(x,y+.6,.25,.25,9.2,'frame',3.2);
  }
  for(let i=0;i<18;i++)box(438+i*5.2,478,1.5,7,3,'stone',.58);
  block(482,515,90,43,2,0,false,.2,'brick','redBright');box(482,515,95,48,.28,'metal',3.8);
  // Curved red-screened volumes of the culture wing, visible in the 2025 photographs.
  box(484,280,106,100,.2,'paving',.16);
  for(let lobe=0;lobe<4;lobe++){
    const angle=lobe*Math.PI/2,cx=484+Math.cos(angle)*24,cy=280+Math.sin(angle)*25;
    const contour:Point[]=[];for(let i=0;i<64;i++)contour.push([cx+Math.cos(i/64*Math.PI*2)*30,cy+Math.sin(i/64*Math.PI*2)*23]);
    const outline=new THREE.Shape(contour.map(([x,y])=>{const [wx,wz]=mapPosition(x,y);return new THREE.Vector2(wx,-wz);}));
    const geo=new THREE.ExtrudeGeometry(outline,{depth:4.8,bevelEnabled:false});geo.rotateX(-Math.PI/2);
    const volume=new THREE.Mesh(geo,materials.glass);volume.position.y=.4;volume.castShadow=true;volume.receiveShadow=true;volume.name='文体中心弧形玻璃体量';campus.add(volume);
    shape(contour,'roofFlat',5.22);
    line([...contour,contour[0]],1.2,'metal',5.25,false);
    for(let i=0;i<42;i++){
      const a=i/42*Math.PI*2;box(cx+Math.cos(a)*30.3,cy+Math.sin(a)*23.3,.75,2.2,5.2,'redBright',.3,-a);
    }
  }

  // East campus residential buildings follow the arc between hill and river.
  for(const [x,y,w,d,rot,floors] of [[949,74,45,14,-.6,11],[985,48,45,14,-.32,11],[1028,36,47,17,0,10],[1075,74,18,55,.2,8],[1095,126,18,58,.23,8],[1036,87,45,15,0,7],[1046,118,46,16,0,7],[1059,158,47,18,0,6]]){
    block(x,y,w,d,floors,rot,false,.2,'residence','stone');
    const p=at(x,y,-w/2+4,d/2+.5,rot);box(p[0],p[1],4,.45,floors*1.25-.3,'glass',.65,rot);
  }
  for(const [x,y]of [[1003,117],[1020,145],[1070,178],[971,95]])tree(x,y,1.5);
  block(1123,235,53,23,4,.48);block(1143,298,42,64,4,.47);
  for(let i=0;i<4;i++){const p=at(1106,201,(i-1.5)*10,0,.4);box(p[0],p[1],8,28,3.5,'stone',.2,.4);}
  // Nanyong: seven staggered courtyards and a planted sloping spine (ARTS built-project plan).
  const nRot=.46;
  for(const [dx,dy] of [[-32,-46],[-32,0],[-32,46],[33,-66],[33,-22],[33,22],[33,66]]){
    const p=at(1253,409,dx,dy,nRot);court(p[0],p[1],48,39,5,nRot,8,'redBright');
  }
  const spineProfile=[[-86,2.0],[-60,5.8],[-36,6.6],[-12,3.2],[12,3.2],[34,7.5],[53,6.1],[73,2.0],[90,.5]];
  const spineVertices:number[]=[],spineIndices:number[]=[];
  for(let j=0;j<spineProfile.length;j++)for(const side of [-1,1]){
    const [dy,h]=spineProfile[j],p=worldAt(1253,409,side*10,dy,h,nRot);spineVertices.push(p.x,p.y,p.z);
    if(j<spineProfile.length-1&&side===-1){const a=j*2;spineIndices.push(a,a+2,a+1,a+1,a+2,a+3);}
  }
  const spineGeo=new THREE.BufferGeometry();spineGeo.setAttribute('position',new THREE.Float32BufferAttribute(spineVertices,3));spineGeo.setIndex(spineIndices);spineGeo.computeVertexNormals();
  const spine=new THREE.Mesh(spineGeo,materials.grass);spine.name='南雍楼中央山脊屋顶花园';spine.castShadow=true;spine.receiveShadow=true;campus.add(spine);roofThickness(spine,.26,'stone');
  for(let j=0;j<spineProfile.length-1;j++) {
    const [ya,ha]=spineProfile[j],[yb,hb]=spineProfile[j+1];
    for(const side of [-1,1]) {
      const a=worldAt(1253,409,side*10,ya,ha+.13,nRot),b=worldAt(1253,409,side*10,yb,hb+.13,nRot);
      beam(a,b,.10,'stone');beam(a.clone().add(new THREE.Vector3(0,.6,0)),b.clone().add(new THREE.Vector3(0,.6,0)),.023);
      for(let t=0;t<=1;t+=.25){const p=a.clone().lerp(b,t);beam(p,p.clone().add(new THREE.Vector3(0,.6,0)),.022);}
    }
  }
  // Slanted glass ends, diagonal mullions and the broad canopy facing the blue track.
  for(const side of [-1,1]){
    const points=[worldAt(1253,409,side*10,30,.3,nRot),worldAt(1253,409,side*10,30,7.2,nRot),worldAt(1253,409,side*10,86,.6,nRot)];
    const g=new THREE.BufferGeometry().setFromPoints(points);g.setIndex(side===1?[0,2,1]:[0,1,2]);g.computeVertexNormals();
    const glass=new THREE.Mesh(g,materials.glass);glass.castShadow=true;campus.add(glass);
    for(let y=33;y<80;y+=5){const h=7.2-(y-30)/56*6.6;beam(worldAt(1253,409,side*10.15,y,.35,nRot),worldAt(1253,409,side*10.15,y,h,nRot),.028,'metal');}
  }
  const canopy=at(1253,409,0,86,nRot);box(canopy[0],canopy[1],122,18,.24,'roof',3.15,nRot);
  for(let x=-55;x<=55;x+=11)beam(worldAt(1253,409,x,91,.25,nRot),worldAt(1253,409,x,91,3.15,nRot),.075,'metal');
  for(let i=0;i<12;i++){const p=at(1253,409,0,86-i*1.2,nRot);box(p[0],p[1],18,1.25,.10*(i+1),'stone',.2,nRot);}
  for(const side of [-1,1]){const p=at(1253,409,side*21,78,nRot);box(p[0],p[1],14,10,1.7,'redBright',.3,nRot);}
  for(const side of [-1,1])for(let i=0;i<10;i++){const p=at(1253,409,side*69,(i-4.5)*12,nRot);tree(p[0],p[1],.9);}
  // Zhiyuan living cluster, southeast of the running track.
  block(1435,602,51,18,6,-.45,false,.2,'residence','stone');block(1467,631,46,20,6,-.45,false,.2,'residence','stone');block(1476,597,19,43,6,-.45,false,.2,'residence','stone');
  // Science and innovation courts and their eastern curved research frontage.
  for(const [dx,dy]of [[-44,-48],[46,-48],[-44,45],[46,45]])court(1532+dx,793+dy,55,57,dy<0?9:7,0,11,'redBright');
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
