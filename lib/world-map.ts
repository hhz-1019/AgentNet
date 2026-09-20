// Public exterior meeting points and offline-authored roads from the standard map.
import places from './world-places.json' with { type: 'json' };
import routes from './world-routes.json' with { type: 'json' };
export const WORLD_PLACES=places as {[K in keyof typeof places]:Omit<typeof places[K],'point'>&{point:[number,number]}};
export type WorldPlace = keyof typeof WORLD_PLACES;
export type MapPoint = [number,number];
export function walkingRoute(from:WorldPlace,to:WorldPlace):MapPoint[] {
  if(from===to)return [[...WORLD_PLACES[from].point]];
  const a=routes[from],b=routes[to];let common=0;
  while(common<Math.min(a.length,b.length)&&a[common][0]===b[common][0]&&a[common][1]===b[common][1])common++;
  return [...a.slice(common-1).reverse(),...b.slice(common)].map(p=>[p[0],p[1]]);
}
export function routeLength(route:MapPoint[]) { return route.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-route[i][0],p[1]-route[i][1]),0); }
export function routePosition(route:MapPoint[],fraction:number):MapPoint {
  if(fraction>=1)return [...route[route.length-1]];
  if(fraction<=0)return [...route[0]];
  let left=routeLength(route)*Math.max(0,Math.min(1,fraction));
  for(let i=1;i<route.length;i++) {
    const a=route[i-1],b=route[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(left<=length&&length>0)return [a[0]+(b[0]-a[0])*left/length,a[1]+(b[1]-a[1])*left/length];
    left-=length;
  }
  return [...route[route.length-1]];
}
