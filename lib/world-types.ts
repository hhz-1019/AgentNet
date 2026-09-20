import type { MapPoint, WorldPlace } from './world-map.ts';
import type { GENDER_LABELS, PersonalMemory } from './personal-memory.ts';
import type { PrivacySettings,ContextProposal } from './character-settings.ts';
import type { CollaborationView } from './world-collaboration.ts';

export type WorldEvent = { id:string; seq:number; at:number; kind:'human'|'reply'|'arrival'|'departure'|'activity'|'memory'|'connection'|'profile'|'plan'; text:string; sources:string[] };
export type DayPlan = {day:string;updatedAt:number;items:{place:WorldPlace;activity:string;notBefore:number;intention:string;status:'pending'|'completed'|'skipped'}[]};
export type Relationship = {id:string;name:string;sent:number;received:number;firstAt:number;lastAt:number};
export type Dialogue = {withId:string;status:'waiting'|'active'|'ended'|'expired';turns:number;canSpeak:boolean;canEnd:boolean;resumeAt:number;sourceIds:string[]};
export type Character = {
  id:string; name:string; profile:string; createdAt:number;
  gender?:keyof typeof GENDER_LABELS; personalMemory?:PersonalMemory|null;
  privacy?:PrivacySettings; pendingContext?:ContextProposal|null; resolvedContextId?:string;
  seenNearbyIds?:string[];
  place:WorldPlace; motion:null|{ route:MapPoint[]; from:WorldPlace; to:WorldPlace; startAt:number; endAt:number };
  activity:string; intention:string; energy:number; energyAt:number; nextWake:number;
  paused:boolean; lastReadSeq:number; lastHumanSeq:number; retryAt:number;
  heartbeatAt:number; driverName:string; driverError:string; connectedUntil:number;
  driverMode?:'online'|'waiting'|'model_budget';
  socialEnabled?:boolean; lastSocialSeq?:number; nextSocialAt?:number;
  lease:null|{ id:string; until:number; observedSeq:number; sourceIds:string[]; observedSocialSeq?:number; nearbyIds?:string[];collaborations?:Record<string,number> };
  lastDecisionId:string; usage:{ hourStart:number; calls:number; inputTokens:number; outputTokens:number };
  budget?:{dailyLimit:number;day:string;calls:number};
  dayPlan?:DayPlan|null;
};
export type Neighbor = { id:string; name:string; place:WorldPlace; activity:string; connected:boolean;publicSummary?:string };
export type Conversation = { id:string; seq:number; at:number; place:WorldPlace; speakerId:string; speakerName:string; recipientId:string; recipientName:string; text:string;kind?:'message'|'end'|'collaboration' };
export type WorldView = { serverNow:number; account:string; authMode?:'email'|'campus'|'legacy'; agentAuthorized?:boolean; agentExpiresAt?:number|null; character:Omit<Character,'lease'|'lastDecisionId'>|null; events:WorldEvent[]; connected:boolean; nearby:Neighbor[]; conversations:Conversation[];relationships?:Relationship[];dialogues?:Dialogue[];collaborations?:CollaborationView[] };
