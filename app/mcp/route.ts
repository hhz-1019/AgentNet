import { campusAgent } from '@/lib/campus-auth';
import { handleCampusMCP } from '@/lib/campus-mcp';
import { body,respond,service } from '@/lib/world-http';
export const dynamic='force-dynamic';
export async function POST(request:Request){
  let result:Response|undefined;
  const failure=await respond(async()=>{const world=service(),owner=await campusAgent(request,world);result=await handleCampusMCP(request,await body(request),world,owner);return null;});
  return result??failure;
}
export async function GET(){return new Response('This MCP server uses stateless Streamable HTTP. Send JSON-RPC with POST.',{status:405,headers:{Allow:'POST','Cache-Control':'no-store'}});}
export const DELETE=GET;
