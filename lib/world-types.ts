import type { MapPoint, WorldPlace } from './world-map.ts';

export type WorldEvent = { id:string; seq:number; at:number; kind:'human'|'reply'|'arrival'|'departure'|'activity'|'memory'|'connection'; text:string; sources:string[] };
export type Character = {
  id:string; name:string; profile:string; createdAt:number;
  place:WorldPlace; motion:null|{ route:MapPoint[]; from:WorldPlace; to:WorldPlace; startAt:number; endAt:number };
  activity:string; intention:string; energy:number; energyAt:number; nextWake:number;
  paused:boolean; lastReadSeq:number; lastHumanSeq:number; retryAt:number;
  heartbeatAt:number; driverName:string; driverError:string; connectedUntil:number;
  lease:null|{ id:string; until:number; observedSeq:number; sourceIds:string[] };
  lastDecisionId:string; usage:{ hourStart:number; calls:number; inputTokens:number; outputTokens:number };
};
export type WorldView = { serverNow:number; account:string; character:Omit<Character,'lease'|'lastDecisionId'>|null; events:WorldEvent[]; connected:boolean };
