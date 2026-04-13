import { neon } from '@neondatabase/serverless';

// ─────────────────────────────────────────────────────────────
// Neon client — reads DATABASE_URL from environment.
// ─────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _neonFn: any = DATABASE_URL ? neon(DATABASE_URL) : null;
const sql = _neonFn;

let schemaInitialized = false;

// ─────────────────────────────────────────────────────────────
// Schema init — runs once per cold start (lazy, first DB call)
// ─────────────────────────────────────────────────────────────

async function ensureSchema(): Promise<void> {
  if (!sql || schemaInitialized) return;
  schemaInitialized = true;

  await sql`
    CREATE TABLE IF NOT EXISTS simulations (
      id            TEXT PRIMARY KEY,
      started_at    TEXT NOT NULL,
      finished_at   TEXT NOT NULL,
      total_rounds  INTEGER NOT NULL DEFAULT 0,
      total_deaths  INTEGER NOT NULL DEFAULT 0,
      winner_id     TEXT,
      winner_name   TEXT,
      created_at    TEXT NOT NULL DEFAULT (now()::text)
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS simulation_tributes (
      id             TEXT NOT NULL,
      simulation_id  TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
      name           TEXT NOT NULL,
      pronouns       TEXT NOT NULL DEFAULT 'they/them',
      image_url      TEXT,
      district       TEXT,
      skills         TEXT NOT NULL DEFAULT '[]',
      alive          INTEGER NOT NULL DEFAULT 1,
      death_round    INTEGER,
      death_cause    TEXT,
      kills          INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (simulation_id, id)
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS simulation_events (
      id             TEXT NOT NULL,
      simulation_id  TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
      round          INTEGER NOT NULL,
      stage          TEXT NOT NULL,
      message        TEXT NOT NULL,
      is_fatal       INTEGER NOT NULL DEFAULT 0,
      deaths         TEXT NOT NULL DEFAULT '[]',
      killers        TEXT NOT NULL DEFAULT '[]',
      tags           TEXT NOT NULL DEFAULT '[]',
      cause          TEXT NOT NULL DEFAULT 'killed',
      PRIMARY KEY (simulation_id, id)
    );
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_tributes_sim ON simulation_tributes(simulation_id);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_events_sim   ON simulation_events(simulation_id);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_events_round ON simulation_events(simulation_id, round);`;
}

// ─────────────────────────────────────────────────────────────
// Row types (mirrors DB columns)
// ─────────────────────────────────────────────────────────────

export interface SimRow {
  id: string;
  started_at: string;
  finished_at: string;
  total_rounds: number;
  total_deaths: number;
  winner_id: string | null;
  winner_name: string | null;
  created_at: string;
}

export interface TributeRow {
  id: string;
  simulation_id: string;
  name: string;
  pronouns: string;
  image_url: string | null;
  district: string | null;
  skills: string;
  alive: number;
  death_round: number | null;
  death_cause: string | null;
  kills: number;
}

export interface EventRow {
  id: string;
  simulation_id: string;
  round: number;
  stage: string;
  message: string;
  is_fatal: number;
  deaths: string;
  killers: string;
  tags: string;
  cause: string;
}

// ─────────────────────────────────────────────────────────────
// Simulations
// ─────────────────────────────────────────────────────────────

export interface SimInput {
  id: string;
  startedAt: string;
  finishedAt: string;
  totalRounds: number;
  totalDeaths: number;
  winnerId?: string;
  winnerName?: string;
}

export async function saveSimulation(sim: SimInput): Promise<void> {
  if (!sql) return;
  await ensureSchema();
  await sql`
    INSERT INTO simulations (id, started_at, finished_at, total_rounds, total_deaths, winner_id, winner_name)
    VALUES (
      ${sim.id},
      ${sim.startedAt},
      ${sim.finishedAt},
      ${sim.totalRounds},
      ${sim.totalDeaths},
      ${sim.winnerId ?? null},
      ${sim.winnerName ?? null}
    )
  `;
}

export async function getSimulation(id: string): Promise<SimRow | null> {
  if (!sql) return null;
  await ensureSchema();
  const rows = await sql<[SimRow]>`SELECT * FROM simulations WHERE id = ${id}`;
  return rows[0] ?? null;
}

export async function listSimulations(limit = 20, offset = 0): Promise<SimRow[]> {
  if (!sql) return [];
  await ensureSchema();
  return sql<SimRow[]>`
    SELECT * FROM simulations
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export async function countSimulations(): Promise<number> {
  if (!sql) return 0;
  await ensureSchema();
  const [row] = await sql<[{ cnt: number }]>`SELECT COUNT(*) as cnt FROM simulations`;
  return row?.cnt ?? 0;
}

export async function deleteSimulation(id: string): Promise<void> {
  if (!sql) return;
  await ensureSchema();
  await sql`DELETE FROM simulations WHERE id = ${id}`;
}

// ─────────────────────────────────────────────────────────────
// Tributes
// ─────────────────────────────────────────────────────────────

export interface TributeInput {
  id: string;
  simulationId: string;
  name: string;
  pronouns: string;
  imageUrl?: string;
  district?: string;
  skills: string[];
  alive: boolean;
  deathRound?: number;
  deathCause?: string;
  kills: number;
}

export async function saveTributes(tributes: TributeInput[]): Promise<void> {
  if (!sql || tributes.length === 0) return;
  await ensureSchema();
  for (const t of tributes) {
    await sql`
      INSERT INTO simulation_tributes
        (id, simulation_id, name, pronouns, image_url, district, skills, alive, death_round, death_cause, kills)
      VALUES (
        ${t.id},
        ${t.simulationId},
        ${t.name},
        ${t.pronouns},
        ${t.imageUrl ?? null},
        ${t.district ?? null},
        ${JSON.stringify(t.skills)},
        ${t.alive ? 1 : 0},
        ${t.deathRound ?? null},
        ${t.deathCause ?? null},
        ${t.kills}
      )
    `;
  }
}

export async function getTributesForSimulation(simId: string): Promise<TributeInput[]> {
  if (!sql) return [];
  await ensureSchema();
  const rows = await sql<TributeRow[]>`
    SELECT * FROM simulation_tributes WHERE simulation_id = ${simId} ORDER BY name
  `;
  return rows.map((r: TributeRow) => ({
    id:           r.id,
    simulationId: r.simulation_id,
    name:         r.name,
    pronouns:     r.pronouns,
    imageUrl:     r.image_url ?? undefined,
    district:     r.district ?? undefined,
    skills:       JSON.parse(r.skills),
    alive:        Boolean(r.alive),
    deathRound:   r.death_round ?? undefined,
    deathCause:   r.death_cause ?? undefined,
    kills:        r.kills,
  }));
}

// ─────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────

export interface EventInput {
  id: string;
  simulationId: string;
  round: number;
  stage: string;
  message: string;
  isFatal: boolean;
  deaths: { tributeId: string; tributeName: string }[];
  killers: { tributeId: string; tributeName: string }[];
  tags: string[];
  cause: string;
}

export async function saveEvents(events: EventInput[]): Promise<void> {
  if (!sql || events.length === 0) return;
  await ensureSchema();
  for (const e of events) {
    await sql`
      INSERT INTO simulation_events
        (id, simulation_id, round, stage, message, is_fatal, deaths, killers, tags, cause)
      VALUES (
        ${e.id},
        ${e.simulationId},
        ${e.round},
        ${e.stage},
        ${e.message},
        ${e.isFatal ? 1 : 0},
        ${JSON.stringify(e.deaths)},
        ${JSON.stringify(e.killers)},
        ${JSON.stringify(e.tags)},
        ${e.cause}
      )
    `;
  }
}

export async function getEventsForSimulation(simId: string): Promise<EventInput[]> {
  if (!sql) return [];
  await ensureSchema();
  const rows = await sql<EventRow[]>`
    SELECT * FROM simulation_events WHERE simulation_id = ${simId} ORDER BY round, stage
  `;
  return rows.map((r: EventRow) => ({
    id:           r.id,
    simulationId: r.simulation_id,
    round:        r.round,
    stage:        r.stage,
    message:      r.message,
    isFatal:      Boolean(r.is_fatal),
    deaths:       JSON.parse(r.deaths),
    killers:      JSON.parse(r.killers),
    tags:         JSON.parse(r.tags),
    cause:        r.cause,
  }));
}

// ─────────────────────────────────────────────────────────────
// Full simulation loader
// ─────────────────────────────────────────────────────────────

export interface FullSimulation {
  simulation: SimRow;
  tributes: TributeInput[];
  events: EventInput[];
}

export async function getFullSimulation(id: string): Promise<FullSimulation | null> {
  const sim = await getSimulation(id);
  if (!sim) return null;
  const [tributes, events] = await Promise.all([
    getTributesForSimulation(id),
    getEventsForSimulation(id),
  ]);
  return { simulation: sim, tributes, events };
}
