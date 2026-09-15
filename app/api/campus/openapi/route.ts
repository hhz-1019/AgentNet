import { campusOpenAPI } from '@/lib/campus-tools';
import { json } from '@/lib/world-http';
export const dynamic='force-dynamic';
export function GET(request:Request){return json(campusOpenAPI(new URL(request.url).origin));}
