import { DriverCommand } from '@/lib/driver-command';
import { body,respond,service } from '@/lib/world-http';
import { WorldError } from '@/lib/world-service';
export const dynamic='force-dynamic';
export async function POST(request:Request){return respond(async()=>{
  const token=request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if(!token)throw new WorldError(401,'需要角色专用连接凭据。');
  const c=DriverCommand.parse(await body(request)),world=service();
  if(c.op==='pair')return world.pairing(token);
  const owner=await world.driverOwner(token);
  if(c.op==='status')return world.view(owner);
  if(c.op==='observe')return world.observe(owner,c.driverId,c.endsAt);
  if(c.op==='decide'){await world.decide(owner,c.leaseId,c.decision,c.usage);return {accepted:true};}
  await world.failure(owner,c.leaseId,c.message);return {accepted:true};
});}
