import { CAMPUS_SCOPE,mcpResource } from '@/lib/campus-oauth';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{wellKnown:string[]}>}){
  const path=(await params).wellKnown.join('/'),origin=new URL(request.url).origin;
  const headers={'Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'};
  if(path==='.well-known/oauth-protected-resource'||path==='.well-known/oauth-protected-resource/mcp')return Response.json({resource:mcpResource(origin),authorization_servers:[origin],scopes_supported:[CAMPUS_SCOPE],bearer_methods_supported:['header']},{headers});
  if(path==='.well-known/oauth-authorization-server')return Response.json({issuer:origin,authorization_endpoint:origin+'/oauth/authorize',token_endpoint:origin+'/oauth/token',registration_endpoint:origin+'/oauth/register',response_types_supported:['code'],grant_types_supported:['authorization_code'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],scopes_supported:[CAMPUS_SCOPE]},{headers});
  return Response.json({error:'Not found'},{status:404,headers:{'Cache-Control':'no-store'}});
}
