import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Raycaster, Vector3 } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildCampus } from '../lib/campus-model.ts';
import { LOCATIONS, mapPosition } from '../lib/campus-data.ts';

// GLTFExporter uses the browser FileReader wrapper for Blob buffers.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result=result; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(result => { this.result=`data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.(); }); }
};
const model=buildCampus();
assert.equal(new Set(LOCATIONS.map(p=>p.id)).size,9);
assert(mapPosition(LOCATIONS[1].x,LOCATIONS[1].y)[0]<mapPosition(LOCATIONS[7].x,LOCATIONS[7].y)[0],'Library must be west of Zhuangli Hill');
let meshes=0,instances=0;
model.traverse(object=>{
  if(!object.isMesh)return;
  meshes++;instances+=object.isInstancedMesh?object.count:1;
  const position=object.geometry.getAttribute('position');
  for(const value of position.array)assert(Number.isFinite(value),'All geometry coordinates must be finite');
  if(object.isInstancedMesh)for(const value of object.instanceMatrix.array)assert(Number.isFinite(value),'Every building detail must have a finite transform');
});
const eastTrack=model.getObjectByName('东区蓝色跑道');
assert(eastTrack?.isMesh,'The real east running track must exist as ground geometry');
assert(eastTrack.material.color.b>eastTrack.material.color.r*3,'East track must be blue, not red');
const westTrack=model.getObjectByName('西区紫色跑道');
assert(westTrack?.isMesh,'The location-confirmed west track must exist');
assert(westTrack.material.color.r>westTrack.material.color.g*1.5&&westTrack.material.color.b>westTrack.material.color.r*1.5,'West track must be purple and distinct from the blue east track');
// Cast through a pane and its neighboring pier on the standard map's teacher residence.
// The actual glass must sit behind the masonry, rather than be a sticker on a solid wall.
model.updateMatrixWorld(true);
const ray=new Raycaster(),probe=(px)=>{
  const [x,z]=mapPosition(px,186);ray.set(new Vector3(x,1.09,z),new Vector3(0,0,-1));ray.far=2;
  return ray.intersectObject(model,true)[0];
};
const pane=probe(484.8),pier=probe(480.5);
assert(pane?.object.material.name.startsWith('glass')&&pier?.object.material.name==='residence','A pane and its adjoining masonry must be separate visible surfaces');
assert(pane.distance-pier.distance>.12,'Window glass must have measurable recess depth behind the facade');
for(const name of ['图书馆飞檐','南雍楼中央山脊屋顶花园','西区文体中心银色风帆屋面']) {
  const mesh=model.getObjectByName(name);assert(mesh?.isMesh,`${name} must be a modeled architectural feature`);
  const normals=mesh.geometry.getAttribute('normal');
  let upwards=0;for(let i=0;i<normals.count;i++)upwards+=normals.getY(i);
  assert(upwards>0,`${name} must face upward and remain visible from the campus overview`);
  assert(model.getObjectByName(`${name}厚边与檐底`)?.isMesh,`${name} must have a modeled edge and underside`);
}
assert(meshes>30&&instances>1000,'Campus must contain actual architectural and landscape geometry');
const buffer=await new GLTFExporter().parseAsync(model,{binary:true,onlyVisible:true});
assert(buffer instanceof ArrayBuffer);
assert.equal(new DataView(buffer).getUint32(0,true),0x46546c67);
await mkdir('public/models',{recursive:true});
await writeFile('public/models/nju-suzhou-campus.glb',Buffer.from(buffer));
console.log(JSON.stringify({meshes,instances,locations:LOCATIONS.length,bytes:buffer.byteLength,output:'public/models/nju-suzhou-campus.glb'}));
