import { tokenHash } from './world-service.ts';

export const CAMPUS_SCOPE='campus:agent';
export const OAUTH_CODE_TTL=5*60*1000;

export function mcpResource(origin:string){return new URL('/mcp',origin).toString();}
export function validRedirect(value:string){
  try{
    const url=new URL(value);
    if(url.username||url.password||url.hash)return false;
    if(url.protocol==='https:')return true;
    return url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  }catch{return false;}
}
export function redirectUris(input:unknown){
  if(!Array.isArray(input)||input.length<1||input.length>5)throw new Error('redirect_uris 需要包含 1–5 个回调地址。');
  const values=[...new Set(input)];
  if(values.some(v=>typeof v!=='string'||v.length>500||!validRedirect(v)))throw new Error('回调地址需要使用 HTTPS；本机客户端可使用 localhost HTTP。');
  return values as string[];
}
export function oauthRequest(url:URL,client:{redirectUris:string[]},origin:string){
  const responseType=url.searchParams.get('response_type'),clientId=url.searchParams.get('client_id')??'',redirectUri=url.searchParams.get('redirect_uri')??'';
  const challenge=url.searchParams.get('code_challenge')??'',method=url.searchParams.get('code_challenge_method'),resource=url.searchParams.get('resource')??'';
  const scope=url.searchParams.get('scope')??CAMPUS_SCOPE;
  if(responseType!=='code'||!clientId)throw new Error('授权请求缺少 response_type=code 或 client_id。');
  if(!client.redirectUris.includes(redirectUri))throw new Error('redirect_uri 未注册。');
  if(method!=='S256'||!/^[A-Za-z0-9_-]{43,128}$/.test(challenge))throw new Error('此连接需要 PKCE S256。');
  if(resource!==mcpResource(origin))throw new Error('resource 必须是当前校园 MCP 地址。');
  if(scope.split(/\s+/).some(value=>value!==CAMPUS_SCOPE))throw new Error('请求了校园不支持的权限。');
  return {clientId,redirectUri,challenge,resource,scope:CAMPUS_SCOPE,state:url.searchParams.get('state')??''};
}
export async function verifyPkce(verifier:string,challenge:string){
  if(!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))return false;
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  const encoded=btoa(String.fromCharCode(...digest)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  return encoded===challenge;
}
export async function oauthHash(value:string){return tokenHash('oauth:'+value);}
export function appendOAuth(url:string,values:Record<string,string>){const target=new URL(url);for(const [key,value] of Object.entries(values))if(value)target.searchParams.set(key,value);return target.toString();}
