import { body,respond,service } from '@/lib/world-http';
import { campusAgent } from '@/lib/campus-auth';
import { runCampusTool } from '@/lib/campus-tools';
export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{name:string}>}){return respond(async()=>{
  const world=service(),owner=await campusAgent(request,world),{name}=await context.params;
  return runCampusTool(world,owner,name,await body(request),request.signal);
});}
