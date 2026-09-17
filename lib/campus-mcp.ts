import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ZodError } from 'zod';
import { CAMPUS_INSTRUCTIONS,CAMPUS_TOOLS,runCampusTool } from './campus-tools.ts';
import { WorldError,type WorldService } from './world-service.ts';

export async function handleCampusMCP(request:Request,parsedBody:unknown,world:WorldService,owner:string){
  // One stateless SDK transport per request. Identity and all durable state are
  // checked in D1; a shared in-memory server would mix different users' context.
  const server=new McpServer({name:'AgentNet',version:'1.0.0'},{instructions:CAMPUS_INSTRUCTIONS});
  for(const tool of CAMPUS_TOOLS){
    server.registerTool(tool.name,{description:tool.description,inputSchema:tool.schema,annotations:{readOnlyHint:tool.readOnly,destructiveHint:false,openWorldHint:false,idempotentHint:tool.name!=='campus_observe'}},async (args:unknown)=>{
      try{const result=await runCampusTool(world,owner,tool.name,args);return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result};}
      catch(error){
        const status=error instanceof WorldError?error.status:error instanceof ZodError?400:503;
        const message=error instanceof WorldError?error.message:error instanceof ZodError?'参数格式无效，请检查工具说明。':'校园暂时不可用，请稍后重试。';
        return {isError:true,content:[{type:'text' as const,text:JSON.stringify({error:message,status})}]};
      }
    });
  }
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  await server.connect(transport);
  try{
    const response=await transport.handleRequest(request,{parsedBody});
    response.headers.set('Cache-Control','private, no-store');response.headers.set('Vary','Authorization');
    return response;
  }finally{await server.close();}
}
