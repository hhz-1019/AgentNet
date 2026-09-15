import { env } from 'cloudflare:workers';
import { ZodError } from 'zod';
import { WorldError, WorldService } from './world-service';
import { campusOwner,sameOrigin } from './campus-auth';
export function service(){if(!env.DB)throw new WorldError(503,'校园记忆暂时无法连接，请稍后重试。');return new WorldService(env.DB);}
export function user(request:Request,world:WorldService){return campusOwner(request,world);}
export async function body(request:Request,human=false){
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new WorldError(415,'需要 JSON 请求。');
  if(human)sameOrigin(request,true);
  if(Number(request.headers.get('content-length'))>16000)throw new WorldError(413,'内容太长，请缩短后再发送。');
  const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
  if(reader){while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16000){await reader.cancel();throw new WorldError(413,'内容太长，请缩短后再发送。');}chunks.push(part.value);}}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const text=new TextDecoder().decode(bytes);
  try{return JSON.parse(text);}catch{throw new WorldError(400,'请求格式无效。');}
}
export function json(value:unknown,status=200){return Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie, Authorization','X-Content-Type-Options':'nosniff'}});}
export async function respond(run:()=>Promise<unknown>){try{return json(await run());}catch(error){
  if(error instanceof WorldError){const response=json({error:error.message},error.status);if(error.status===401)response.headers.set('WWW-Authenticate','Bearer realm="campus"');return response;}
  if(error instanceof ZodError)return json({error:'内容格式不符合要求，请检查输入。'},400);
  console.error('Campus world request failed',error instanceof Error?error.name:'UnknownError');
  return json({error:'校园暂时无法保存或读取，请稍后重试。'},503);
}}
