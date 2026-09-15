import { json } from '@/lib/world-http';
import { toolCatalog } from '@/lib/campus-tools';
export function GET(){return json(toolCatalog());}
