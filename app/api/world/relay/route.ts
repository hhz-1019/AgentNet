import { z } from 'zod';
import { DriverCommand } from '@/lib/driver-command';
import { body,respond,service,user } from '@/lib/world-http';
import { WorldError } from '@/lib/world-service';

export const dynamic='force-dynamic';
const envelope=z.object({token:z.string().regex(/^[a-f0-9]{64}$/),command:DriverCommand}).strict();

// The browser uses its own Sites login; no owner bypass or ChatGPT credentials
// are exported to another computer. The role token remains separately revocable.
export async function POST(request:Request){return respond(async()=>{
  const world=service(),account=await user(request,world),{token,command:c}=envelope.parse(await body(request,true));
  await world.row(account.id);
  let owner:string|null=null;
  try{owner=await world.driverOwner(token);}catch(e){if(!(e instanceof WorldError&&e.status===401))throw e;}
  if(owner&&owner!==account.id)throw new WorldError(403,'这个连接属于另一个校园账号，请使用自己的连接程序。');
  if(c.op==='pair'){
    if(!owner){const pair=await world.pairing(token);await world.claim(account.id,pair.code);}
    return {paired:true};
  }
  if(!owner)throw new WorldError(401,'连接尚未配对或已撤销，请重新启动并连接。');
  if(c.op==='status')return world.view(owner);
  if(c.op==='observe')return world.observe(owner,c.driverId,c.endsAt,true);
  if(c.op==='decide'){await world.decide(owner,c.leaseId,c.decision,c.usage);return {accepted:true};}
  await world.failure(owner,c.leaseId,c.message);return {accepted:true};
});}
