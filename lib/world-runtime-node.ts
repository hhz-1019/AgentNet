import { sqliteStore } from '../scripts/sqlite-store.mjs';
// Direct Node deployments must never trust user-supplied Sites identity headers.
export const trustedSiteIdentity=false;
let db:D1Database|undefined;
export function database(){return db??=sqliteStore(process.env.CAMPUS_DB_PATH??'.campus-local/world.sqlite') as unknown as D1Database;}
