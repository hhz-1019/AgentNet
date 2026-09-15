import { WorldError, type WorldService } from './world-service.ts';

export const OWNER_COOKIE='campus_owner';
export const OWNER_KEY=/^campus_owner_[a-f0-9]{64}$/;
export function randomSecret(){return [...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function cookieName(request:Request){return new URL(request.url).protocol==='https:'?'__Host-'+OWNER_COOKIE:OWNER_COOKIE;}
export function ownerCookie(key:string,request:Request){return `${cookieName(request)}=${key}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${key?30*86400:0}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
export function sameOrigin(request:Request,required=false){
  const origin=request.headers.get('origin');
  if((required&&!origin)||(origin&&origin!==new URL(request.url).origin))throw new WorldError(403,'请从校园页面操作；Agent 请从自己的客户端直接连接。');
}
export async function campusOwner(request:Request,world:WorldService){
  const name=cookieName(request),key=request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1);
  if(key){if(key==='signed_out')throw new WorldError(401,'请先创建或恢复校园角色。');if(!OWNER_KEY.test(key))throw new WorldError(401,'校园身份已失效，请恢复身份。');return {id:await world.ownerByKey(key),account:'独立校园身份',authMode:'campus' as const};}
  // Existing Sites identities remain a migration path for their existing characters.
  const id=request.headers.get('oai-authenticated-user-id');
  if(id)return {id,account:request.headers.get('oai-authenticated-user-email')??'原有校园账号',authMode:'legacy' as const};
  throw new WorldError(401,'请先创建或恢复校园角色。');
}
export async function campusAgent(request:Request,world:WorldService){
  sameOrigin(request);
  const token=request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
  if(!token)throw new WorldError(401,'请提供角色的 Agent 连接密钥，使用 Authorization: Bearer <token>。');
  return world.driverOwner(token);
}
