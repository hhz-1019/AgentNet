import { z } from 'zod';
import { body,respond,service,user } from '@/lib/world-http';
import { WorldError } from '@/lib/world-service';
export const dynamic='force-dynamic';
const command=z.discriminatedUnion('op',[
  z.object({op:z.literal('create'),name:z.string().trim().min(1).max(20),profile:z.string().trim().max(1000)}).strict(),
  z.object({op:z.literal('message'),text:z.string().trim().min(1).max(1500),requestId:z.uuid()}).strict(),
  z.object({op:z.literal('pause'),paused:z.boolean()}).strict(),
  z.object({op:z.literal('disconnect')}).strict(),
  z.object({op:z.literal('claim'),code:z.string().regex(/^[A-F0-9]{10}$/)}).strict(),
]);
export async function GET(request:Request){return respond(async()=>{const account=user(request),world=service();try{return {...await world.view(account.id),account:account.account};}catch(e){if(e instanceof WorldError&&e.status===404)return {serverNow:Date.now(),account:account.account,character:null,events:[],connected:false};throw e;}});}
export async function POST(request:Request){return respond(async()=>{
  const account=user(request),c=command.parse(await body(request,true)),world=service();
  if(c.op==='create')await world.create(account.id,c.name,c.profile);
  if(c.op==='message')await world.message(account.id,c.text,c.requestId);
  if(c.op==='pause')await world.pause(account.id,c.paused);
  if(c.op==='disconnect')await world.disconnect(account.id);
  if(c.op==='claim')await world.claim(account.id,c.code);
  return {...await world.view(account.id),account:account.account};
});}
