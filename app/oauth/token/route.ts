import { CAMPUS_SCOPE,mcpResource,oauthHash,verifyPkce } from '@/lib/campus-oauth';
import { randomSecret } from '@/lib/campus-auth';
import { service } from '@/lib/world-http';
export const dynamic='force-dynamic';
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff'}});
export async function POST(request:Request){
  try{
    if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return reply({error:'invalid_request',error_description:'token endpoint 需要表单编码。'},400);
    if(Number(request.headers.get('content-length'))>16000)return reply({error:'invalid_request',error_description:'请求内容过长。'},400);
    const text=await request.text();if(text.length>16000)return reply({error:'invalid_request',error_description:'请求内容过长。'},400);
    const form=new URLSearchParams(text);if(form.get('grant_type')!=='authorization_code')return reply({error:'unsupported_grant_type'},400);
    const code=form.get('code')??'',hash=await oauthHash(code),world=service(),now=Date.now();
    const row=await world.db.prepare('SELECT client_id,owner_id,redirect_uri,code_challenge,resource,scope,expires_at FROM campus_oauth_codes WHERE code_hash=?').bind(hash).first<{client_id:string;owner_id:string;redirect_uri:string;code_challenge:string;resource:string;scope:string;expires_at:number}>();
    const valid=row&&row.expires_at>now&&row.client_id===form.get('client_id')&&row.redirect_uri===form.get('redirect_uri')&&row.resource===form.get('resource')&&row.resource===mcpResource(new URL(request.url).origin)&&await verifyPkce(form.get('code_verifier')??'',row.code_challenge);
    if(!valid)return reply({error:'invalid_grant',error_description:'授权码无效、已过期或 PKCE 校验失败。'},400);
    const removed=await world.db.prepare('DELETE FROM campus_oauth_codes WHERE code_hash=? AND expires_at>?').bind(hash,now).run();if(removed.meta.changes!==1)return reply({error:'invalid_grant'},400);
    const token=randomSecret(),issued=await world.issueAgentToken(row.owner_id,token);
    return reply({access_token:token,token_type:'Bearer',expires_in:Math.max(1,Math.floor((issued.expiresAt-now)/1000)),scope:row.scope??CAMPUS_SCOPE,resource:row.resource});
  }catch{return reply({error:'server_error',error_description:'校园暂时无法签发连接，请稍后重试。'},503);}
}
