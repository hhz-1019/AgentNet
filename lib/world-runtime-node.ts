import { sqliteStore } from '../scripts/sqlite-store.mjs';
// Direct Node deployments must never trust user-supplied Sites identity headers.
export const trustedSiteIdentity=false;
let db:D1Database|undefined;
export function database(){return db??=sqliteStore(process.env.CAMPUS_DB_PATH??'.campus-local/world.sqlite') as unknown as D1Database;}
export const mailSettings=()=>({apiKey:process.env.RESEND_API_KEY,from:process.env.CAMPUS_EMAIL_FROM});
