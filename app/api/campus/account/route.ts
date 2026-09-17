import { z } from 'zod';
import { body,respond,service,user } from '@/lib/world-http';
import { OWNER_KEY,ownerCookie,randomSecret,sessionCookie,sessionToken } from '@/lib/campus-auth';
import { CampusEmailLogin } from '@/lib/campus-email';
import { CharacterGender } from '@/lib/personal-memory';
import { WorldError } from '@/lib/world-service';

export const dynamic='force-dynamic';
const command=z.discriminatedUnion('op',[
  z.object({op:z.literal('create'),name:z.string().trim().min(1).max(20),gender:CharacterGender.default('unspecified'),socialEnabled:z.boolean().default(false),recoveryKey:z.string().regex(OWNER_KEY)}).strict(),
  z.object({op:z.literal('restore'),recoveryKey:z.string().regex(OWNER_KEY)}).strict(),
  z.object({op:z.literal('recovery-key')}).strict(),
  z.object({op:z.literal('agent-token')}).strict(),
  z.object({op:z.literal('signout')}).strict(),
]);
export async function POST(request:Request){
  let cookie:string|undefined;
  let clearSession=false;
  const response=await respond(async()=>{
    const c=command.parse(await body(request,true)),world=service();
    if(c.op==='signout'){const token=sessionToken(request);if(token)await new CampusEmailLogin(world.db).revoke(token);clearSession=true;cookie=ownerCookie('signed_out',request);return {ok:true};}
    if(c.op==='create'||c.op==='recovery-key')throw new WorldError(410,'请使用校园邮箱登录；旧角色可在面板内绑定邮箱。');
    if(c.op==='restore'){
      const owner=await world.ownerByKey(c.recoveryKey);
      const token=sessionToken(request);if(token)await new CampusEmailLogin(world.db).revoke(token);clearSession=true;
      cookie=ownerCookie(c.recoveryKey,request);
      return {ok:true,characterId:(await world.row(owner)).id};
    }
    const account=await user(request,world);
    const token=randomSecret(),result=await world.issueAgentToken(account.id,token);
    return {token,...result};
  });
  if(cookie&&response.ok)response.headers.set('Set-Cookie',cookie);
  if(clearSession&&response.ok)response.headers.append('Set-Cookie',sessionCookie('',request));
  return response;
}
