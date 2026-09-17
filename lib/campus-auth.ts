import { WorldError, type WorldService } from './world-service.ts';
import { trustedSiteIdentity } from '@/lib/world-runtime';
import { CampusEmailLogin, SESSION_SECONDS } from './campus-email.ts';

export const OWNER_COOKIE='campus_owner';
export const OWNER_KEY=/^campus_owner_[a-f0-9]{64}$/;
export function randomSecret(){return [...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function cookieName(request:Request){return new URL(request.url).protocol==='https:'?'__Host-'+OWNER_COOKIE:OWNER_COOKIE;}
export function ownerCookie(key:string,request:Request){return `${cookieName(request)}=${key}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${key?30*86400:0}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
export function sessionToken(request:Request){const name=new URL(request.url).protocol==='https:'?'__Host-campus_session':'campus_session';return request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1);}
export function sessionCookie(token:string,request:Request){const secure=new URL(request.url).protocol==='https:';return `${secure?'__Host-':''}campus_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token?SESSION_SECONDS:0}${secure?'; Secure':''}`;}
export function sameOrigin(request:Request,required=false){
  const origin=request.headers.get('origin');
  if((required&&!origin)||(origin&&origin!==new URL(request.url).origin))throw new WorldError(403,'请从校园页面操作；Agent 请从自己的客户端直接连接。');
}
export async function campusOwner(request:Request,world:WorldService){
  const token=sessionToken(request);
  if(token){const account=await new CampusEmailLogin(world.db).session(token);if(!account)throw new WorldError(401,'登录已过期，请重新使用校园邮箱登录。');return {...account,authMode:'email' as const};}
  const name=cookieName(request),key=request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1);
  if(key){if(key==='signed_out')throw new WorldError(401,'请先使用校园邮箱登录。');if(!OWNER_KEY.test(key))throw new WorldError(401,'请重新使用校园邮箱登录。');return {id:await world.ownerByKey(key),account:'尚未绑定邮箱的旧角色',authMode:'campus' as const};}
  // Existing Sites identities remain a migration path for their existing characters.
  const id=trustedSiteIdentity?request.headers.get('oai-authenticated-user-id'):null;
  if(id){if(await world.db.prepare('SELECT 1 FROM campus_accounts WHERE owner_id=?').bind(id).first())throw new WorldError(401,'该角色已绑定邮箱，请使用校园邮箱登录。');return {id,account:request.headers.get('oai-authenticated-user-email')??'原有校园账号',authMode:'legacy' as const};}
  throw new WorldError(401,'请先使用校园邮箱登录。');
}
export async function campusAgent(request:Request,world:WorldService){
  sameOrigin(request);
  const token=request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
  if(!token)throw new WorldError(401,'请提供角色的 Agent 连接密钥，使用 Authorization: Bearer <token>。');
  return world.driverOwner(token);
}
