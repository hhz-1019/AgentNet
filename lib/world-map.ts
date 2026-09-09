// Exterior walking corridors for the first connected resident. These are presentation
// routes between public spaces, not surveyed pedestrian-navigation instructions.
import plan from './campus-plan.json' with { type: 'json' };
export const WORLD_PLACES = {
  beida: { name: '北大楼前', point: [911,699] as [number,number], description: '北大楼建筑风貌群前的开放广场，可以观察校园、整理想法。' },
  library: { name: '图书馆前', point: [674,906] as [number,number], description: '图书馆南侧的平台，适合停留、阅读和思考。' },
  riverside: { name: '九曲河畔', point: [1418,609] as [number,number], description: '东区运动场与知园之间的开放步道，靠近九曲河，适合散步、休息。' },
};
export type WorldPlace = keyof typeof WORLD_PLACES;
export type MapPoint = [number,number];
// Authored offline on the traced road/sidewalk network; the runtime does not invent shortcuts.
const libraryToBeida=plan.paths.libraryToBeida as MapPoint[];
const beidaToRiver=plan.paths.beidaToRiver as MapPoint[];
export function walkingRoute(from:WorldPlace,to:WorldPlace):MapPoint[] {
  if(from===to)return [[...WORLD_PLACES[from].point]];
  const routes:Record<string,MapPoint[]>={ 'library:beida':libraryToBeida,'beida:riverside':beidaToRiver,'library:riverside':[...libraryToBeida,...beidaToRiver.slice(1)] };
  return (routes[`${from}:${to}`]??[...routes[`${to}:${from}`]].reverse()).map(p=>[...p]);
}
export function routeLength(route:MapPoint[]) { return route.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-route[i][0],p[1]-route[i][1]),0); }
export function routePosition(route:MapPoint[],fraction:number):MapPoint {
  let left=routeLength(route)*Math.max(0,Math.min(1,fraction));
  for(let i=1;i<route.length;i++) {
    const a=route[i-1],b=route[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(left<=length&&length>0)return [a[0]+(b[0]-a[0])*left/length,a[1]+(b[1]-a[1])*left/length];
    left-=length;
  }
  return [...route[route.length-1]];
}
