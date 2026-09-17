import { z } from 'zod';
import { body,respond,service,user } from '@/lib/world-http';
import { WorldError } from '@/lib/world-service';
import { CharacterGender, PersonalMemoryInput } from '@/lib/personal-memory';
export const dynamic='force-dynamic';
const command=z.discriminatedUnion('op',[
  z.object({op:z.literal('create'),name:z.string().trim().min(1).max(20),gender:CharacterGender.optional(),profile:z.string().trim().max(1000).optional(),socialEnabled:z.boolean().optional()}).strict(),
  z.object({op:z.literal('personal-memory'),memory:PersonalMemoryInput.nullable()}).strict(),
  z.object({op:z.literal('participation'),enabled:z.boolean()}).strict(),
  z.object({op:z.literal('message'),text:z.string().trim().min(1).max(1500),requestId:z.uuid()}).strict(),
  z.object({op:z.literal('pause'),paused:z.boolean()}).strict(),
  z.object({op:z.literal('budget'),dailyLimit:z.number().int().min(1).max(144)}).strict(),
  z.object({op:z.literal('disconnect')}).strict(),
  z.object({op:z.literal('claim'),code:z.string().regex(/^[A-F0-9]{10}$/)}).strict(),
]);
export async function GET(request:Request){return respond(async()=>{const world=service(),account=await user(request,world);try{return {...await world.view(account.id),account:account.account,authMode:account.authMode};}catch(e){if(e instanceof WorldError&&e.status===404)return {serverNow:Date.now(),account:account.account,authMode:account.authMode,character:null,events:[],connected:false,nearby:[],conversations:[]};throw e;}});}
export async function POST(request:Request){return respond(async()=>{
  const world=service(),account=await user(request,world),c=command.parse(await body(request,true));
  if(c.op==='create'){if(account.authMode!=='email')throw new WorldError(403,'请先使用校园邮箱登录。');await world.create(account.id,c.name,c.profile,c.socialEnabled,c.gender);}
  if(c.op==='personal-memory')await world.personalMemory(account.id,c.memory);
  if(c.op==='participation')await world.participation(account.id,c.enabled);
  if(c.op==='message')await world.message(account.id,c.text,c.requestId);
  if(c.op==='pause')await world.pause(account.id,c.paused);
  if(c.op==='budget')await world.setDailyLimit(account.id,c.dailyLimit);
  if(c.op==='disconnect')await world.disconnect(account.id);
  if(c.op==='claim')await world.claim(account.id,c.code);
  return {...await world.view(account.id),account:account.account,authMode:account.authMode};
});}
