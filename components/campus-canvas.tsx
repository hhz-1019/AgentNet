'use client';

import { useEffect, useRef, type MutableRefObject } from 'react';
import { MoveUpRight } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildCampus } from '@/lib/campus-model';
import { addCampusSurfaceDetail } from '@/lib/campus-materials';
import { LOCATIONS, mapPosition, type LocationId } from '@/lib/campus-data';

export type CampusControls = { zoom: (factor: number) => void; reset: () => void };
type Props = { selected: LocationId | null; topView: boolean; controlsRef: MutableRefObject<CampusControls | null>; onSelect: (id: LocationId | null) => void; onReady: () => void; onError: (message: string) => void };

export default function CampusCanvas(props: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const markers = useRef<(HTMLButtonElement | null)[]>([]);
  const current = useRef(props); current.current = props;
  const travel = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!mount.current) return;
    const container = mount.current;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' }); }
    catch { current.current.onError('请开启浏览器的图形加速，或在支持 WebGL 的浏览器中打开。地点目录仍可查看。'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.domElement.setAttribute('aria-label', '三维校园。方向键旋转，加减键缩放。地点可以在左侧目录中选择。');
    renderer.domElement.tabIndex = 0;
    container.insertBefore(renderer.domElement, container.firstChild);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#e8eceb');
    const camera = new THREE.OrthographicCamera(-250,250,180,-180,.1,1800);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true; orbit.dampingFactor = .08; orbit.rotateSpeed = .55; orbit.zoomSpeed = .8;
    orbit.minPolarAngle = .035; orbit.maxPolarAngle = Math.PI / 2.17; orbit.minZoom = .45; orbit.maxZoom = 22;
    orbit.screenSpacePanning = false; orbit.maxTargetRadius = 260;
    const model = buildCampus(); addCampusSurfaceDetail(model); scene.add(model);
    const hemi = new THREE.HemisphereLight('#d5e3f2','#747567',.72); scene.add(hemi);
    const sunOffset = new THREE.Vector3(-170,280,140);
    const sun = new THREE.DirectionalLight('#fffaf1',2.8); sun.position.copy(sunOffset); sun.castShadow=true;
    const shadowSize=Math.min(4096,renderer.capabilities.maxTextureSize);
    sun.shadow.mapSize.set(shadowSize,shadowSize); sun.shadow.camera.near=10; sun.shadow.camera.far=700; sun.shadow.normalBias=.035; sun.shadow.bias=-.00006; scene.add(sun,sun.target);
    const sky = new Sky(); sky.scale.setScalar(1000);
    sky.material.uniforms.turbidity.value=3;sky.material.uniforms.rayleigh.value=1.3;
    sky.material.uniforms.sunPosition.value.copy(sunOffset).normalize();
    const skyScene=new THREE.Scene();skyScene.add(sky);
    const pmrem=new THREE.PMREMGenerator(renderer);
    const environment=pmrem.fromScene(skyScene,.06,.1,2000,{size:128});scene.environment=environment.texture;
    pmrem.dispose();sky.geometry.dispose();sky.material.dispose();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400,2400),new THREE.MeshStandardMaterial({color:'#e4e7e3',roughness:1}));
    ground.rotation.x=-Math.PI/2;ground.position.y=-7.2;ground.receiveShadow=true;scene.add(ground);
    const composer=new EffectComposer(renderer);composer.renderTarget1.samples=4;composer.renderTarget2.samples=4;
    const renderPass=new RenderPass(scene,camera),ao=new GTAOPass(scene,camera,512,512),output=new OutputPass();
    ao.updateGtaoMaterial({radius:1.1,thickness:1.3,distanceExponent:1.6,distanceFallOff:1,samples:8});
    ao.updatePdMaterial({radius:4,samples:8,rings:2});ao.blendIntensity=.42;
    composer.addPass(renderPass);composer.addPass(ao);composer.addPass(output);
    let width=1,height=1,baseHalf=180,dirty=true,frame=0;
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
    let flight: { start: number; from: THREE.Vector3; to: THREE.Vector3; targetFrom: THREE.Vector3; targetTo: THREE.Vector3; zoomFrom:number; zoomTo:number; } | null=null;
    const bounds = LOCATIONS.map(p=>{const [x,z]=mapPosition(p.x,p.y);return new THREE.Box3(new THREE.Vector3(x-p.span*.25,0,z-p.span*.25),new THREE.Vector3(x+p.span*.25,p.elevation,z+p.span*.25));});
    const ray = new THREE.Raycaster(), pointer=new THREE.Vector2(), hitPoint = new THREE.Vector3();
    function destination() {
      const p=LOCATIONS.find(p=>p.id===current.current.selected);
      const [x,z]=p?mapPosition(p.x,p.y):[0,0];
      const target=new THREE.Vector3(x,p?p.elevation*.28:0,z);
      const direction=current.current.topView?new THREE.Vector3(.001,1,.04):p?new THREE.Vector3(.62,.77,1.2):width<600?new THREE.Vector3(.42,1.25,1.15):new THREE.Vector3(.76,1.12,1.20);
      const position=target.clone().add(direction.normalize().multiplyScalar(560));
      const zoom=p?Math.min(9,baseHalf*2/(p.span*(width<600?1.45:1))):1;
      return {target,position,zoom};
    }
    function go(immediate=false) {
      const dest=destination();
      const place=LOCATIONS.find(p=>p.id===current.current.selected),shadowSpan=place?Math.max(55,place.span*.85):285;
      sun.target.position.copy(dest.target);sun.position.copy(dest.target).add(sunOffset);
      sun.shadow.camera.left=-shadowSpan;sun.shadow.camera.right=shadowSpan;sun.shadow.camera.top=shadowSpan;sun.shadow.camera.bottom=-shadowSpan;sun.shadow.camera.updateProjectionMatrix();
      renderer.shadowMap.needsUpdate=true;
      ao.enabled=!!place&&width>=800&&!current.current.topView;
      // ponytail: lower-resolution AO only for desktop close views; full-scene mobile AO exceeds the useful GPU budget.
      ao.setSize(ao.enabled?Math.ceil(width*renderer.getPixelRatio()*.6):128,ao.enabled?Math.ceil(height*renderer.getPixelRatio()*.6):128);
      container.dataset.moving = immediate || reduced.matches ? 'false' : 'true';
      if(immediate||reduced.matches){orbit.target.copy(dest.target);camera.position.copy(dest.position);camera.zoom=dest.zoom;camera.updateProjectionMatrix();orbit.update();flight=null;}
      else {flight={start:performance.now(),from:camera.position.clone(),to:dest.position,targetFrom:orbit.target.clone(),targetTo:dest.target,zoomFrom:camera.zoom,zoomTo:dest.zoom};}
      dirty=true;
    }
    function resize() {
      width=container.clientWidth;height=container.clientHeight;if(!width||!height)return;
      const ratio=width/height;baseHalf=Math.max(169,215/ratio);
      camera.left=-baseHalf*ratio;camera.right=baseHalf*ratio;camera.top=baseHalf;camera.bottom=-baseHalf;
      renderer.setSize(width,height);composer.setSize(width,height);camera.updateProjectionMatrix();go(true);
    }
    const observer=new ResizeObserver(resize);observer.observe(container);resize();
    travel.current=()=>go();
    current.current.controlsRef.current={zoom:(factor)=>{flight=null;camera.zoom=THREE.MathUtils.clamp(camera.zoom*factor,.45,18);camera.updateProjectionMatrix();dirty=true;},reset:()=>go()};
    const projected = new THREE.Vector3();
    function updateMarkers() {
      const occupied: { x:number;y:number;w:number;h:number }[]=[];
      const selected=current.current.selected;
      LOCATIONS.forEach((p,i)=>{
        const element=markers.current[i];if(!element)return;
        if(selected&&selected!==p.id){element.style.visibility='hidden';return;}
        const [x,z]=mapPosition(p.x,p.y);projected.set(x,p.elevation+1.5,z).project(camera);
        const sx=(projected.x*.5+.5)*width,sy=(-projected.y*.5+.5)*height;
        const ew=element.offsetWidth||100,eh=element.offsetHeight||50;
        const rect={x:sx-ew/2,y:sy-eh,w:ew,h:eh};
        const overlap=!selected&&occupied.some(r=>rect.x<r.x+r.w+5&&rect.x+rect.w+5>r.x&&rect.y<r.y+r.h&&rect.y+rect.h>r.y);
        const visible=projected.z>=-1&&projected.z<=1&&sx>ew/2+8&&sx<width-ew/2-8&&sy>130&&sy<height-(width<600?120:65)&&!overlap;
        element.style.visibility=visible?'visible':'hidden';
        element.style.transform=`translate3d(${Math.round(rect.x)}px,${Math.round(rect.y)}px,0)`;
        if(visible)occupied.push(rect);
      });
      const needle=document.getElementById('compass-needle');
      if(needle)needle.style.transform=`rotate(${-orbit.getAzimuthalAngle()*180/Math.PI}deg)`;
    }
    let first=true;
    function render(now:number) {
      frame=requestAnimationFrame(render);
      let moving=false;
      if(flight){
        const t=Math.min(1,(now-flight.start)/1350),ease=1-Math.pow(1-t,4);
        camera.position.lerpVectors(flight.from,flight.to,ease);orbit.target.lerpVectors(flight.targetFrom,flight.targetTo,ease);
        camera.zoom=THREE.MathUtils.lerp(flight.zoomFrom,flight.zoomTo,ease);camera.updateProjectionMatrix();moving=true;
        if(t===1){flight=null;container.dataset.moving='false';}
      }
      const changed=orbit.update();
      if(dirty||changed||moving){composer.render();updateMarkers();dirty=false;}
      if(first){first=false;current.current.onReady();}
    }
    frame=requestAnimationFrame(render);
    const onStart=()=>{flight=null;container.dataset.moving='false';};orbit.addEventListener('start',onStart);
    let downX=0,downY=0;
    const pointerDown=(event:PointerEvent)=>{downX=event.clientX;downY=event.clientY;};
    const pointerUp=(event:PointerEvent)=>{
      if(event.button!==0||Math.hypot(event.clientX-downX,event.clientY-downY)>5)return;
      const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);
      let nearest=Infinity,index=-1;
      bounds.forEach((bound,i)=>{if(ray.ray.intersectBox(bound,hitPoint)){const distance=hitPoint.distanceTo(ray.ray.origin);if(distance<nearest){nearest=distance;index=i;}}});
      if(index>=0)current.current.onSelect(LOCATIONS[index].id);
    };
    const keyDown=(event:KeyboardEvent)=>{
      if(['+','=','-','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))event.preventDefault();
      if(event.key==='+'||event.key==='=')current.current.controlsRef.current?.zoom(1.2);
      if(event.key==='-')current.current.controlsRef.current?.zoom(.83);
      if(event.key==='Home')go();
      if(event.key.startsWith('Arrow')){flight=null;const offset=camera.position.clone().sub(orbit.target),s=new THREE.Spherical().setFromVector3(offset);if(event.key==='ArrowLeft')s.theta-=.1;if(event.key==='ArrowRight')s.theta+=.1;if(event.key==='ArrowUp')s.phi-=.08;if(event.key==='ArrowDown')s.phi+=.08;s.phi=THREE.MathUtils.clamp(s.phi,.035,Math.PI/2.17);camera.position.copy(orbit.target).add(new THREE.Vector3().setFromSpherical(s));dirty=true;}
    };
    const contextLost=(event:Event)=>{event.preventDefault();current.current.onError('图形连接已中断。请重新加载页面，或关闭其他占用图形资源的页面。');};
    renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',pointerUp);renderer.domElement.addEventListener('keydown',keyDown);renderer.domElement.addEventListener('webglcontextlost',contextLost);
    return ()=>{
      cancelAnimationFrame(frame);observer.disconnect();orbit.dispose();travel.current=null;current.current.controlsRef.current=null;
      renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointerup',pointerUp);renderer.domElement.removeEventListener('keydown',keyDown);renderer.domElement.removeEventListener('webglcontextlost',contextLost);
      const geometrySet=new Set<THREE.BufferGeometry>(),materialSet=new Set<THREE.Material>();
      scene.traverse(object=>{if(object instanceof THREE.Mesh){geometrySet.add(object.geometry);(Array.isArray(object.material)?object.material:[object.material]).forEach(m=>materialSet.add(m));}});
      geometrySet.forEach(g=>g.dispose());materialSet.forEach(m=>m.dispose());sun.shadow.map?.dispose();environment.dispose();renderPass.dispose();ao.dispose();output.dispose();composer.dispose();renderer.dispose();renderer.domElement.remove();
    };
  }, []);
  useEffect(()=>{travel.current?.();},[props.selected,props.topView]);
  return <div ref={mount} className="campus-canvas"><div className="map-label-layer">{LOCATIONS.map((place,i)=><button key={place.id} ref={el=>{markers.current[i]=el;}} className="map-marker" aria-label={`进入${place.name}三维场景`} onClick={()=>props.onSelect(place.id)}><span className="map-marker-label">{place.name}<MoveUpRight size={12}/></span><span className="map-marker-stem"/><span className="map-marker-dot"/></button>)}</div></div>;
}
