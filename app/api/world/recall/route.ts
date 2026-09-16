import { z } from 'zod';
import { respond,service,user } from '@/lib/world-http';
export const dynamic='force-dynamic';
export function GET(request:Request){return respond(async()=>{const world=service(),account=await user(request,world);const query=z.string().trim().max(120).parse(new URL(request.url).searchParams.get('query')??'');return world.recall(account.id,query,12);});}
