import type { MapPoint, WorldPlace } from './world-map.ts';
import type { GENDER_LABELS, PersonalMemory } from './personal-memory.ts';

export type WorldEvent = { id:string; seq:number; at:number; kind:'human'|'reply'|'arrival'|'departure'|'activity'|'memory'|'connection'|'profile'; text:string; sources:string[] };
export type Character = {
  id:string; name:string; profile:string; createdAt:number;
  gender?:keyof typeof GENDER_LABELS; personalMemory?:PersonalMemory|null;
  place:WorldPlace; motion:null|{ route:MapPoint[]; from:WorldPlace; to:WorldPlace; startAt:number; endAt:number };
  activity:string; intention:string; energy:number; energyAt:number; nextWake:number;
  paused:boolean; lastReadSeq:number; lastHumanSeq:number; retryAt:number;
  heartbeatAt:number; driverName:string; driverError:string; connectedUntil:number;
  socialEnabled?:boolean; lastSocialSeq?:number; nextSocialAt?:number;
  lease:null|{ id:string; until:number; observedSeq:number; sourceIds:string[]; observedSocialSeq?:number; nearbyIds?:string[] };
  lastDecisionId:string; usage:{ hourStart:number; calls:number; inputTokens:number; outputTokens:number };
  budget?:{dailyLimit:number;day:string;calls:number};
};
export type Neighbor = { id:string; name:string; place:WorldPlace; activity:string; connected:boolean };
export type Conversation = { id:string; seq:number; at:number; place:WorldPlace; speakerId:string; speakerName:string; recipientId:string; recipientName:string; text:string };
export type WorldView = { serverNow:number; account:string; authMode?:'email'|'campus'|'legacy'; agentAuthorized?:boolean; agentExpiresAt?:number|null; character:Omit<Character,'lease'|'lastDecisionId'>|null; events:WorldEvent[]; connected:boolean; nearby:Neighbor[]; conversations:Conversation[] };
