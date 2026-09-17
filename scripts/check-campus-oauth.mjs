import assert from 'node:assert/strict';
import { appendOAuth,CAMPUS_SCOPE,mcpResource,oauthRequest,redirectUris,validRedirect,verifyPkce } from '../lib/campus-oauth.ts';
import { runnerEnvironment as environment } from '../lib/agent-onboarding.ts';

assert(validRedirect('https://agent.example/callback'));
assert(validRedirect('http://127.0.0.1:49152/callback'));
assert(!validRedirect('http://agent.example/callback'));
assert(!validRedirect('javascript:alert(1)'));
assert.deepEqual(redirectUris(['https://agent.example/callback','https://agent.example/callback']),['https://agent.example/callback']);
const verifier='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~abc';
const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
const challenge=Buffer.from(digest).toString('base64url');
assert(await verifyPkce(verifier,challenge));assert(!(await verifyPkce(verifier+'x',challenge)));
const url=new URL('https://campus.example/oauth/authorize');url.search=new URLSearchParams({response_type:'code',client_id:'client',redirect_uri:'https://agent.example/callback',code_challenge:challenge,code_challenge_method:'S256',resource:mcpResource(url.origin),scope:CAMPUS_SCOPE,state:'safe'}).toString();
assert.equal(oauthRequest(url,{redirectUris:['https://agent.example/callback']},url.origin).state,'safe');
assert.equal(new URL(appendOAuth('https://agent.example/callback?kept=1',{code:'abc',state:'safe'})).searchParams.get('kept'),'1');
const env=environment('https://campus.example','a'.repeat(64));assert(env.includes('RUN_MODE=continuous'));assert(env.includes('CAMPUS_TOKEN='+ 'a'.repeat(64)));assert(!env.includes('sk-'));
console.log('PASS: OAuth redirect restrictions, exact registered callback, PKCE S256, resource binding, state preservation and runner configuration.');
