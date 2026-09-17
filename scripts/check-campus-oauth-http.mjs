import assert from 'node:assert/strict';
import { randomBytes,createHash } from 'node:crypto';
import { emailCookie } from './email-http-fixture.mjs';

const base=(process.env.CAMPUS_TEST_URL??'http://127.0.0.1:3107').replace(/\/$/,'');
const json=async(path,options={})=>{const response=await fetch(base+path,{redirect:'manual',...options});const data=await response.json();return {response,data};};
const protectedMetadata=await json('/.well-known/oauth-protected-resource');
assert.equal(protectedMetadata.response.status,200);assert.equal(protectedMetadata.data.resource,base+'/mcp');
const authorizationMetadata=await json('/.well-known/oauth-authorization-server');
assert.equal(authorizationMetadata.data.registration_endpoint,base+'/oauth/register');

const cookie=await emailCookie(base);
const created=await json('/api/world',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({op:'create',name:'OAuth验证',gender:'unspecified',socialEnabled:false})});
assert.equal(created.response.status,200);
const registered=await json('/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'OAuth HTTP 验证',redirect_uris:['http://127.0.0.1:49152/callback'],token_endpoint_auth_method:'none'})});
assert.equal(registered.response.status,201);assert(registered.data.client_id);

const verifier=randomBytes(48).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
const params=new URLSearchParams({response_type:'code',client_id:registered.data.client_id,redirect_uri:'http://127.0.0.1:49152/callback',code_challenge:challenge,code_challenge_method:'S256',resource:base+'/mcp',scope:'campus:agent',state:'http-check'});
const consent=await fetch(base+'/oauth/authorize?'+params,{headers:{Cookie:cookie}});assert.equal(consent.status,200);assert((await consent.text()).includes('OAuth HTTP 验证'));
params.set('decision','allow');const approval=await fetch(base+'/oauth/authorize?'+params,{method:'POST',redirect:'manual',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:params});
assert.equal(approval.status,303);const callback=new URL(approval.headers.get('location'));assert.equal(callback.searchParams.get('state'),'http-check');const code=callback.searchParams.get('code');assert(code);
const token=await json('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,client_id:registered.data.client_id,redirect_uri:'http://127.0.0.1:49152/callback',code_verifier:verifier,resource:base+'/mcp'})});
assert.equal(token.response.status,200);assert.match(token.data.access_token,/^[a-f0-9]{64}$/);
const replay=await json('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,client_id:registered.data.client_id,redirect_uri:'http://127.0.0.1:49152/callback',code_verifier:verifier,resource:base+'/mcp'})});assert.equal(replay.response.status,400);
const status=await json('/api/campus/tools/campus_status',{method:'POST',headers:{Authorization:'Bearer '+token.data.access_token,'Content-Type':'application/json'},body:'{}'});assert.equal(status.data.character.name,'OAuth验证');
const challengeResponse=await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}})});
assert.equal(challengeResponse.status,401);assert(challengeResponse.headers.get('www-authenticate').includes('/.well-known/oauth-protected-resource'));
const mcp=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+token.data.access_token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}})});assert.equal(mcp.status,200);assert.equal((await mcp.json()).result.serverInfo.name,'nju-suzhou-campus');
console.log('PASS: live OAuth discovery, DCR, consent, PKCE exchange, one-time code, scoped role token, WWW-Authenticate challenge and MCP SDK initialization.');
