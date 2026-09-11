import * as THREE from 'three';
// A compact, neutral campus resident; no real person's appearance is inferred.
export function createCompanionModel(color='#713f55'){
  const group=new THREE.Group();group.name='我的校园伙伴';
  const coat=new THREE.MeshStandardMaterial({color,roughness:.85}),skin=new THREE.MeshStandardMaterial({color:'#d6b797',roughness:.9}),dark=new THREE.MeshStandardMaterial({color:'#303c3c',roughness:.92}),paper=new THREE.MeshStandardMaterial({color:'#d9e2d3',roughness:1});
  const add=(geometry:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=group)=>{const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.receiveShadow=true;parent.add(m);return m;};
  add(new THREE.CapsuleGeometry(.25,.38,4,10),coat,0,.96,0);
  add(new THREE.SphereGeometry(.23,12,10),skin,0,1.58,0);
  add(new THREE.SphereGeometry(.235,12,8,0,Math.PI*2,0,Math.PI*.47),dark,0,1.63,0);
  const legs:THREE.Group[]=[],arms:THREE.Group[]=[];
  for(const side of [-1,1]){
    const leg=new THREE.Group();leg.position.set(side*.135,.64,0);group.add(leg);legs.push(leg);add(new THREE.CapsuleGeometry(.085,.35,3,6),dark,0,-.25,0,leg);add(new THREE.BoxGeometry(.18,.12,.3),dark,0,-.5,.055,leg);
    const arm=new THREE.Group();arm.position.set(side*.3,1.18,0);group.add(arm);arms.push(arm);add(new THREE.CapsuleGeometry(.075,.33,3,6),coat,0,-.22,0,arm);add(new THREE.SphereGeometry(.08,7,5),skin,0,-.44,0,arm);
  }
  add(new THREE.BoxGeometry(.12,.29,.23),paper,-.36,.8,.13);
  const shadow=add(new THREE.CircleGeometry(.4,24),new THREE.MeshBasicMaterial({color:'#263b30',transparent:true,opacity:.23,depthWrite:false}),0,.02,0);shadow.rotation.x=-Math.PI/2;shadow.scale.y=.72;
  group.scale.setScalar(.8);group.visible=false;
  return {group,legs,arms};
}
