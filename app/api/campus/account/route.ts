import { z } from 'zod';
import { body,respond,service,user } from '@/lib/world-http';
import { OWNER_KEY,ownerCookie,randomSecret } from '@/lib/campus-auth';
import { CharacterGender } from '@/lib/personal-memory';
import { tokenHash,WorldError } from '@/lib/world-service';

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
  const response=await respond(async()=>{
    const c=command.parse(await body(request,true)),world=service();
    if(c.op==='signout'){cookie=ownerCookie('signed_out',request);return {ok:true};}
    if(c.op==='create'||c.op==='restore'){
      let owner:string|undefined;
      try{owner=await world.ownerByKey(c.recoveryKey);}catch(error){if(!(error instanceof WorldError&&error.status===401))throw error;}
      if(!owner){
        if(c.op==='restore')throw new WorldError(401,'恢复密钥无效或已更换，请检查后重试。');
        await world.registrationLimit(request.headers.get('cf-connecting-ip')??'unavailable');
        const hash=await tokenHash(c.recoveryKey);owner='campus:'+hash;
        // A secure key is generated once on the client; retries use the same
        // identity and cannot overwrite its character or history.
        await world.create(owner,c.name,'',c.socialEnabled,c.gender,hash);
      }
      cookie=ownerCookie(c.recoveryKey,request);
      return {ok:true,characterId:(await world.row(owner)).id};
    }
    const account=await user(request,world);
    if(c.op==='recovery-key'){
      const key='campus_owner_'+randomSecret();await world.setOwnerKey(account.id,key);
      cookie=ownerCookie(key,request);return {recoveryKey:key};
    }
    const token=randomSecret(),result=await world.issueAgentToken(account.id,token);
    return {token,...result};
  });
  if(cookie&&response.ok)response.headers.set('Set-Cookie',cookie);
  return response;
}
