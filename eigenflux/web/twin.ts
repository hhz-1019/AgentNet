export const AGREEMENT_VERSION = '2026-10-09';
export interface Persona {
  traits: Record<string, number>;
  speaking_style: string;
  decision_style: string;
  risk_preference: string;
  social_preference: string;
}
export interface Episode {
  id: string;
  content: string;
  emotion_score: number;
  importance: number;
  decay_rate: number;
  occurred_at: number | null;
}
export interface Knowledge {
  id: string;
  concept: string;
  description: string;
  confidence: number;
}
export interface Relationship {
  id: string;
  target_id: string;
  description: string;
  intimacy: number;
  trust: number;
  emotion: number;
}
export interface TwinProfile {
  name: string;
  basic_info: Record<string, string>;
  persona: Persona;
  episodes: Episode[];
  knowledge: Knowledge[];
  relationships: Relationship[];
  current_goal: string;
}
export interface TwinResponse {
  revision: number;
  profile: TwinProfile;
  agreement_accepted?: boolean;
}
export interface ActivityPolicy {
  daily_posts: number;
  daily_searches: number;
  daily_feedback: number;
  revision: number;
}
export function emptyTwin(): TwinProfile {
  return {
    name: '',
    basic_info: {},
    persona: {
      traits: {},
      speaking_style: '',
      decision_style: '',
      risk_preference: '',
      social_preference: '',
    },
    episodes: [],
    knowledge: [],
    relationships: [],
    current_goal: '',
  };
}
// Normalize partial Agent drafts without inventing personality or biography.
export function normalizeTwin(
  value?: Partial<TwinProfile> | null,
): TwinProfile {
  const base = emptyTwin();
  return {
    ...base,
    ...value,
    basic_info: { ...value?.basic_info },
    persona: {
      ...base.persona,
      ...value?.persona,
      traits: { ...value?.persona?.traits },
    },
    episodes: value?.episodes || [],
    knowledge: value?.knowledge || [],
    relationships: value?.relationships || [],
  };
}
