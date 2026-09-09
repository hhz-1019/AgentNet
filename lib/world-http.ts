import { env } from 'cloudflare:workers';
import { ZodError } from 'zod';
import { WorldError, WorldService } from './world-service';
export function service(){if(!env.DB)throw new WorldError(503,'校园记忆暂时无法连接，请稍后重试。');return new WorldService(env.DB);}
export function user(request:Request){const id=request.headers.get('oai-authenticated-user-id');if(!id)throw new WorldError(401,'请先使用 ChatGPT 登录，再接入你的角色。');return {id,account:request.headers.get('oai-authenticated-user-email')??'已登录的 ChatGPT 账号'};}
export async function body(request:Request,human=false){
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new WorldError(415,'需要 JSON 请求。');
  if(human&&request.headers.get('origin')!==new URL(request.url).origin)throw new WorldError(403,'请从校园页面操作。');
  if(Number(request.headers.get('content-length'))>16000)throw new WorldError(413,'内容太长，请缩短后再发送。');
  const text=await request.text();if(text.length>16000)throw new WorldError(413,'内容太长，请缩短后再发送。');
  try{return JSON.parse(text);}catch{throw new WorldError(400,'请求格式无效。');}
}
export function json(value:unknown,status=200){return Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie, Authorization','X-Content-Type-Options':'nosniff'}});}
export async function respond(run:()=>Promise<unknown>){try{return json(await run());}catch(error){
  if(error instanceof WorldError)return json({error:error.message},error.status);
  if(error instanceof ZodError)return json({error:'内容格式不符合要求，请检查输入。'},400);
  console.error('Campus world request failed',error instanceof Error?error.name:'UnknownError');
  return json({error:'校园暂时无法保存或读取，请稍后重试。'},503);
}}
