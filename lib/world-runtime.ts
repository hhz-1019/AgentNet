import { env } from 'cloudflare:workers';
export const trustedSiteIdentity=true;
export const database=()=>env.DB;
export const mailSettings=()=>({apiKey:env.RESEND_API_KEY,from:env.CAMPUS_EMAIL_FROM});
