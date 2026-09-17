import { appendOAuth,CAMPUS_SCOPE,mcpResource,OAUTH_CODE_TTL,oauthHash,oauthRequest } from '@/lib/campus-oauth';
import { campusOwner,sameOrigin } from '@/lib/campus-auth';
import { service } from '@/lib/world-http';
import { WorldError } from '@/lib/world-service';
export const dynamic='force-dynamic';
const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
async function context(request:Request){
  const world=service(),url=new URL(request.url),clientId=url.searchParams.get('client_id')??'';
  const client=await world.db.prepare('SELECT client_name,redirect_uris FROM campus_oauth_clients WHERE client_id=?').bind(clientId).first<{client_name:string;redirect_uris:string}>();
  if(!client)throw new WorldError(400,'这个客户端尚未在校园注册。');
  const parsed=oauthRequest(url,{redirectUris:JSON.parse(client.redirect_uris)},url.origin);
  return {world,url,clientName:client.client_name,...parsed};
}
function page(title:string,content:string,status=200){return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><style>html{color:#273330;background:#f4f3ef;font:15px/1.8 system-ui,"Microsoft YaHei",sans-serif}body{margin:0;padding:32px 18px}.card{max-width:520px;margin:8vh auto;background:#fff;padding:32px;border:1px solid #dfe3dd;border-radius:14px;box-shadow:0 20px 70px #34443c14}h1{font:500 28px/1.45 Georgia,"Songti SC",serif;margin:0 0 14px}p{color:#5e6b61}.notice{padding:14px 16px;background:#f0e9ed;border-radius:8px;color:#663849}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:26px}button,a.button{appearance:none;border:1px solid #663849;border-radius:7px;padding:10px 18px;font:inherit;text-decoration:none;cursor:pointer}button.primary,a.primary{background:#663849;color:#fff}button.secondary,a.secondary{background:#fff;color:#663849}</style></head><body><main class="card">${content}</main></body></html>`,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'}});}
export async function GET(request:Request){
  try{
    const c=await context(request);let owner;
    try{owner=await campusOwner(request,c.world);}catch{return page('需要校园身份',`<h1>先进入你的校园身份</h1><p>连接请求来自「${escape(c.clientName)}」。请先在校园创建或恢复角色，再回到 Agent 客户端重新连接。</p><div class="actions"><a class="button primary" href="/?connect=1">打开校园伙伴</a></div>`,401);}
    const view=await c.world.view(owner.id),name=view.character?.name??'当前角色';
    return page('授权校园 Agent',`<h1>允许 ${escape(c.clientName)} 连接？</h1><p>它将作为「${escape(name)}」的 Agent，读取该角色可见的校园状态、私信与经历，并提交自主行动。</p><p>完成后返回：${escape(new URL(c.redirectUri).origin)}</p><p class="notice">授权会替换这个角色此前的 Agent 连接。校园恢复密钥、其他角色的私密内容和你的模型账号不会交给客户端。</p><form method="post">${[...c.url.searchParams].map(([k,v])=>`<input type="hidden" name="${escape(k)}" value="${escape(v)}">`).join('')}<div class="actions"><button class="primary" name="decision" value="allow">允许连接</button><button class="secondary" name="decision" value="deny">取消</button></div></form>`);
  }catch(error){return page('无法授权',`<h1>无法完成授权</h1><p>${escape(error instanceof Error?error.message:'授权请求无效。')}</p>`,400);}
}
export async function POST(request:Request){
  try{
    sameOrigin(request,true);const raw=await request.formData(),url=new URL(request.url);for(const [key,value] of raw)if(key!=='decision'&&typeof value==='string')url.searchParams.set(key,value);
    const forwarded=new Request(url,{headers:request.headers}),c=await context(forwarded),owner=await campusOwner(request,c.world);
    if(raw.get('decision')!=='allow')return Response.redirect(appendOAuth(c.redirectUri,{error:'access_denied',state:c.state}),303);
    const code=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),hash=await oauthHash(code),expiresAt=Date.now()+OAUTH_CODE_TTL;
    await c.world.db.batch([c.world.db.prepare('DELETE FROM campus_oauth_codes WHERE expires_at<?').bind(Date.now()),c.world.db.prepare('INSERT INTO campus_oauth_codes(code_hash,client_id,owner_id,redirect_uri,code_challenge,resource,scope,expires_at) VALUES(?,?,?,?,?,?,?,?)').bind(hash,c.clientId,owner.id,c.redirectUri,c.challenge,mcpResource(c.url.origin),CAMPUS_SCOPE,expiresAt)]);
    return Response.redirect(appendOAuth(c.redirectUri,{code,state:c.state}),303);
  }catch(error){return page('无法授权',`<h1>无法完成授权</h1><p>${escape(error instanceof Error?error.message:'授权请求无效。')}</p>`,400);}
}
