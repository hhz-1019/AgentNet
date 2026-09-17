import { z } from 'zod';
import { redirectUris } from '@/lib/campus-oauth';
import { body,respond,service } from '@/lib/world-http';
export const dynamic='force-dynamic';
const registration=z.object({redirect_uris:z.array(z.string()),client_name:z.string().trim().min(1).max(80).default('外部 MCP 客户端'),token_endpoint_auth_method:z.literal('none').optional(),grant_types:z.array(z.string()).optional(),response_types:z.array(z.string()).optional()}).loose();
export async function POST(request:Request){const response=await respond(async()=>{
  const input=registration.parse(await body(request)),redirects=redirectUris(input.redirect_uris),world=service();
  await world.registrationLimit('oauth:'+(request.headers.get('cf-connecting-ip')??'unavailable'));
  const clientId='campus_client_'+crypto.randomUUID().replaceAll('-',''),createdAt=Date.now();
  await world.db.prepare('INSERT INTO campus_oauth_clients(client_id,client_name,redirect_uris,created_at) VALUES(?,?,?,?)').bind(clientId,input.client_name,JSON.stringify(redirects),createdAt).run();
  return {client_id:clientId,client_name:input.client_name,redirect_uris:redirects,client_id_issued_at:Math.floor(createdAt/1000),token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code']};
});return response.ok?new Response(response.body,{status:201,headers:response.headers}):response;}
