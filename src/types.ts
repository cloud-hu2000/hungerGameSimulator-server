// ============================================================
// Core domain types for the Hunger Games Simulator
// ============================================================

export type PronounType = 'he/him' | 'she/her' | 'they/them' | 'they/them (plural)';

export type RelationshipType = 'ally' | 'enemy' | 'neutral';

export type EventStage = 'bloodbath' | 'day' | 'night' | 'feast' | 'all';

export type DeathCause =
  | 'alive'
  | 'killed'
  | 'accident'
  | 'environment'
  | 'self'
  | 'infection'
  | 'exposure'
  | 'hunger'
  | 'thirst';

export interface Tribute {
  id: string;
  name: string;
  pronouns: PronounType;
  imageUrl?: string; // base64 data URL or external URL
  district?: string;
  skills: string[]; // e.g. ['archery', 'stealth', 'strength']
  alive: boolean;
  deathRound?: number;
  deathCause: DeathCause;
  kills: number;
  alliances: string[]; // tribute IDs
  enemies: string[];   // tribute IDs
}

export interface Relationship {
  from: string;  // tribute ID
  to: string;    // tribute ID
  type: RelationshipType;
  strength: number; // 1-5, affects weight calculation
}

// Raw event as defined in the event pool
export interface GameEvent {
  id: string;
  message: string;       // template with %0, %1, ... %N, %A, %G, %R, etc.
  stage: EventStage;
  playerCount: number;   // how many players this event involves
  deaths: number[];      // indices of players who die in this event (relative to % placeholders)
  killers: number[];     // indices of players who kill in this event
  isFatal: boolean;
  isAllianceRelated: boolean; // whether this event involves ally/enemy relationships
  tags: string[];        // e.g. 'combat', 'trap', 'sponsor', 'survival', 'betrayal'
  rarity: 'common' | 'rare' | 'epic'; // affects selection probability
}

// Parsed event with resolved tribute names
export interface ResolvedEvent {
  id: string;
  message: string;
  stage: EventStage;
  round: number;
  isFatal: boolean;
  deaths: { tributeId: string; tributeName: string }[];
  killers: { tributeId: string; tributeName: string }[];
  tags: string[];
  cause: DeathCause;
}

// Simulation round (one "day" = day phase + night phase)
export interface SimulationRound {
  roundNumber: number;
  dayPhase: ResolvedEvent[];
  nightPhase: ResolvedEvent[];
  feastPhase?: ResolvedEvent[];
  bloodbathPhase?: ResolvedEvent[];
  survivors: Tribute[];
  casualties: Tribute[];
}

// Full simulation result
export interface SimulationResult {
  id: string;
  totalRounds: number;
  winner?: Tribute;
  allRounds: SimulationRound[];
  tributeStats: Tribute[];
  metadata: {
    startedAt: string;
    finishedAt: string;
    totalDeaths: number;
  };
}

// API request/response types
export interface SimulationRequest {
  tributes: Omit<Tribute, 'alive' | 'deathRound' | 'deathCause' | 'kills' | 'alliances' | 'enemies'>[];
  relationships: Relationship[];
  settings: SimulationSettings;
}

export interface SimulationSettings {
  deathsPerRound: number; // max deaths per round (0 = unlimited)
  startOnDay: number;     // day number to start on (0 = bloodbath)
  maxRounds: number;       // safety cap
  feastEnabled: boolean;
}

// Shared API types between client and server
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
