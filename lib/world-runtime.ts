import { env } from 'cloudflare:workers';
export const trustedSiteIdentity=true;
export const database=()=>env.DB;
