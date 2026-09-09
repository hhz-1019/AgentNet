import { z } from 'zod';
import { body,respond,service } from '@/lib/world-http';
import { WorldError } from '@/lib/world-service';
export const dynamic='force-dynamic';
const command=z.discriminatedUnion('op',[
  z.object({op:z.literal('pair')}).strict(),
  z.object({op:z.literal('status')}).strict(),
  z.object({op:z.literal('observe'),driverId:z.uuid(),endsAt:z.number().int().positive()}).strict(),
  z.object({op:z.literal('decide'),leaseId:z.string().max(100),decision:z.unknown(),usage:z.object({inputTokens:z.number().int().min(0).max(1000000),outputTokens:z.number().int().min(0).max(100000)}).strict()}).strict(),
  z.object({op:z.literal('failure'),leaseId:z.string().max(100),message:z.string().max(220)}).strict(),
]);
export async function POST(request:Request){return respond(async()=>{
  const token=request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if(!token)throw new WorldError(401,'需要角色专用连接凭据。');
  const c=command.parse(await body(request)),world=service();
  if(c.op==='pair')return world.pairing(token);
  const owner=await world.driverOwner(token);
  if(c.op==='status')return world.view(owner);
  if(c.op==='observe')return world.observe(owner,c.driverId,c.endsAt);
  if(c.op==='decide'){await world.decide(owner,c.leaseId,c.decision,c.usage);return {accepted:true};}
  await world.failure(owner,c.leaseId,c.message);return {accepted:true};
});}
