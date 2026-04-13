import type {
  Tribute, Relationship, GameEvent, ResolvedEvent,
  SimulationRound, SimulationResult, SimulationRequest,
  DeathCause, PronounType,
} from './types.js';
import { EVENT_POOL } from './events.js';

// ─────────────────────────────────────────────────────────────
// Pronoun resolution
// ─────────────────────────────────────────────────────────────

const PRONOUN_MAP: Record<PronounType, { nom: string; acc: string; gen: string; ref: string }> = {
  'he/him':            { nom: 'he',        acc: 'him',       gen: 'his',       ref: 'himself'    },
  'she/her':           { nom: 'she',       acc: 'her',       gen: 'her',       ref: 'herself'    },
  'they/them':         { nom: 'they',      acc: 'them',      gen: 'their',     ref: 'themselves' },
  'they/them (plural)':{ nom: 'they',     acc: 'them',      gen: 'their',     ref: 'themselves' },
};

function resolvePronouns(pronounType: PronounType, form: 'nom' | 'acc' | 'gen' | 'ref' | 'e' | 's' | 'y' | 'i' | 'h' | '!' | 'w'): string {
  const p = PRONOUN_MAP[pronounType] ?? PRONOUN_MAP['they/them'];
  const isPlural = pronounType === 'they/them (plural)';

  switch (form) {
    case 'nom': return p.nom;
    case 'acc': return p.acc;
    case 'gen': return p.gen;
    case 'ref': return p.ref;
    case 'i':   return isPlural ? 'are'   : 'is';
    case 'h':   return isPlural ? 'have'  : 'has';
    case '!':   return isPlural ? "aren't" : "isn't";
    case 'w':   return isPlural ? 'were'  : 'was';
    case 'e':   return isPlural ? ''      : 'es';
    case 's':   return isPlural ? ''      : 's';
    case 'y':   return isPlural ? ''      : 'ies';
    default:    return p.nom;
  }
}

function formatMessage(
  template: string,
  players: Tribute[],
  killerIndices: number[],
): string {
  // Replace %N{idx}, %A{idx}, %G{idx}, %R{idx}, %i{idx}, %h{idx}, %!{idx}, %w{idx}, %e{idx}, %s{idx}, %y{idx}
  let result = template;

  // Simple name placeholders %0, %1, ...
  result = result.replace(/%(\d+)/g, (_, idx) => {
    const player = players[parseInt(idx)];
    return player ? player.name : `Player${idx}`;
  });

  // Pronoun forms: %X{idx} where X is one letter
  const pronounForms = ['N', 'A', 'G', 'R', 'i', 'h', '!', 'w', 'e', 's', 'y'] as const;
  for (const form of pronounForms) {
    const regex = new RegExp(`%${form}(\\d+)`, 'g');
    result = result.replace(regex, (_, idx) => {
      const player = players[parseInt(idx)];
      if (!player) return `Player${idx}`;
      // Map single-letter form codes to the underlying pronoun key
      const keyMap: Record<string, typeof form> = {
        N: 'N', A: 'A', G: 'G', R: 'R',
        i: 'i', h: 'h', '!': '!', w: 'w', e: 'e', s: 's', y: 'y',
      } as const;
      return resolvePronouns(player.pronouns, keyMap[form] as Parameters<typeof resolvePronouns>[1]);
    });
  }

  // Fix "isn't", "aren't" contractions that would follow a verb awkwardly
  // e.g. "they isn't" → "they isn't" (keep as is, template should be well-written)
  // Fix double spaces
  result = result.replace(/\s{2,}/g, ' ').trim();

  return result;
}

// ─────────────────────────────────────────────────────────────
// Relationship helpers
// ─────────────────────────────────────────────────────────────

type RelationMap = Map<string, { type: 'ally' | 'enemy'; strength: number }>;

function buildRelationMap(tributeIds: string[], relationships: Relationship[]): RelationMap {
  const map: RelationMap = new Map();
  for (const rel of relationships) {
    if (!tributeIds.includes(rel.from) || !tributeIds.includes(rel.to)) continue;
    if (rel.type === 'neutral') continue; // skip neutral — they don't affect weights
    map.set(`${rel.from}|${rel.to}`, { type: rel.type as 'ally' | 'enemy', strength: rel.strength });
  }
  return map;
}

function getRelation(map: RelationMap, from: string, to: string) {
  return map.get(`${from}|${to}`) ?? map.get(`${to}|${from}`) ?? null;
}

function isAllied(a: Tribute, b: Tribute, map: RelationMap): boolean {
  const rel = getRelation(map, a.id, b.id);
  return rel !== null && rel.type === 'ally';
}

function isEnemy(a: Tribute, b: Tribute, map: RelationMap): boolean {
  const rel = getRelation(map, a.id, b.id);
  return rel !== null && rel.type === 'enemy';
}

// ─────────────────────────────────────────────────────────────
// Event weighting
// ─────────────────────────────────────────────────────────────

type RarityWeight = { common: number; rare: number; epic: number };

const RARITY_WEIGHTS: RarityWeight = { common: 60, rare: 30, epic: 10 };

function computeEventWeight(
  event: GameEvent,
  players: Tribute[],
  relMap: RelationMap,
): number {
  let weight = RARITY_WEIGHTS[event.rarity];

  // Alliance-related events get a boost if there are allies in the pool
  if (event.isAllianceRelated) {
    const hasAlliance = players.some(p =>
      players.some(q => q.id !== p.id && isAllied(p, q, relMap)),
    );
    if (hasAlliance) weight = Math.round(weight * 1.5);
  }

  // Combat / kill events get a boost if enemies are present
  if (event.tags.includes('killed') || event.tags.includes('combat')) {
    const hasEnemies = players.some(p =>
      players.some(q => q.id !== p.id && isEnemy(p, q, relMap)),
    );
    if (hasEnemies) weight = Math.round(weight * 1.3);
  }

  // If this is an "ally betrays ally" type event, boost it
  if (event.tags.includes('betrayal')) {
    const hasAllyPair = players.some(p =>
      players.some(q => q.id !== p.id && isAllied(p, q, relMap)),
    );
    if (hasAllyPair) weight = Math.round(weight * 2.0);
  }

  return weight;
}

function weightedRandom<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

// ─────────────────────────────────────────────────────────────
// Event selection
// ─────────────────────────────────────────────────────────────

function selectEventsForPhase(
  phase: 'bloodbath' | 'day' | 'night' | 'feast',
  aliveTributes: Tribute[],
  relMap: RelationMap,
  count: number,
): GameEvent[] {
  const stageCandidates = EVENT_POOL.filter(
    e => e.stage === phase || e.stage === 'all',
  );

  const selected: GameEvent[] = [];

  for (let i = 0; i < count && aliveTributes.length >= 1; i++) {
    // Group events by player count and pick from matching ones
    const possibleEvents = stageCandidates.filter(
      e => e.playerCount <= aliveTributes.length,
    );

    const weighted = possibleEvents.map(e => ({
      event: e,
      weight: computeEventWeight(e, aliveTributes, relMap),
    }));

    const picked = weightedRandom(weighted).event;
    selected.push(picked);
  }

  return selected;
}

// ─────────────────────────────────────────────────────────────
// Event resolution
// ─────────────────────────────────────────────────────────────

function resolveDeathCause(event: GameEvent): DeathCause {
  if (event.deaths.length > 0 && event.killers.length > 0) return 'killed';
  if (event.tags.includes('accident')) return 'accident';
  if (event.tags.includes('environment')) return 'environment';
  if (event.tags.includes('infection')) return 'infection';
  if (event.tags.includes('exposure')) return 'exposure';
  if (event.tags.includes('hunger')) return 'hunger';
  if (event.tags.includes('thirst')) return 'thirst';
  if (event.tags.includes('self')) return 'self';
  return 'killed';
}

function resolveEvent(
  event: GameEvent,
  players: Tribute[],
  round: number,
): ResolvedEvent | null {
  if (event.playerCount > players.length) return null;

  // Pick random players for this event
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, event.playerCount);

  const message = formatMessage(event.message, selected, event.killers);

  const deaths = event.deaths.map(di => ({
    tributeId:   selected[di]?.id   ?? '',
    tributeName: selected[di]?.name ?? '',
  }));

  const killers = event.killers.map(ki => ({
    tributeId:   selected[ki]?.id   ?? '',
    tributeName: selected[ki]?.name ?? '',
  }));

  return {
    id: event.id,
    message,
    stage: event.stage,
    round,
    isFatal: event.isFatal,
    deaths,
    killers,
    tags: event.tags,
    cause: resolveDeathCause(event),
  };
}

// ─────────────────────────────────────────────────────────────
// Main simulation
// ─────────────────────────────────────────────────────────────

export function runSimulation(req: SimulationRequest): SimulationResult {
  const { tributes: rawTributes, relationships, settings } = req;

  // Initialize tributes
  let tributes: Tribute[] = rawTributes.map(t => ({
    ...t,
    alive: true,
    deathRound: undefined,
    deathCause: 'alive' as DeathCause,
    kills: 0,
    alliances: relationships.filter(r => r.type === 'ally' && r.from === t.id).map(r => r.to),
    enemies:   relationships.filter(r => r.type === 'enemy' && r.from === t.id).map(r => r.to),
  }));

  const relMap = buildRelationMap(tributes.map(t => t.id), relationships);
  const allRounds: SimulationRound[] = [];
  const startTime = new Date().toISOString();
  let roundNumber = 0;

  // ── Bloodbath phase ──────────────────────────────────────
  if (settings.startOnDay <= 0) {
    const bloodbathTributes = tributes.filter(t => t.alive);
    const events = selectEventsForPhase('bloodbath', bloodbathTributes, relMap, 8);

    const resolved: ResolvedEvent[] = [];
    for (const ev of events) {
      const r = resolveEvent(ev, bloodbathTributes.filter(t => t.alive), 0);
      if (!r) continue;
      resolved.push(r);
      applyFatalities(r, tributes, 0);
    }

    allRounds.push({
      roundNumber: 0,
      bloodbathPhase: resolved,
      dayPhase: [],
      nightPhase: [],
      survivors: tributes.filter(t => t.alive),
      casualties: tributes.filter(t => !t.alive),
    });
  }

  // ── Main day/night loop ───────────────────────────────────
  let dayNumber = settings.startOnDay > 0 ? settings.startOnDay : 1;
  let gameOver = tributes.filter(t => t.alive).length <= 1;

  while (!gameOver && roundNumber < settings.maxRounds) {
    roundNumber++;
    const aliveTributes = tributes.filter(t => t.alive);

    // Day phase
    const dayEvents = selectEventsForPhase('day', aliveTributes, relMap, 4);
    const dayResolved: ResolvedEvent[] = [];
    for (const ev of dayEvents) {
      const current = tributes.filter(t => t.alive);
      if (current.length <= 1) break;
      const r = resolveEvent(ev, current, roundNumber);
      if (!r) continue;
      dayResolved.push(r);
      applyFatalities(r, tributes, roundNumber);
    }

    // Night phase
    const nightEvents = selectEventsForPhase('night', tributes.filter(t => t.alive), relMap, 4);
    const nightResolved: ResolvedEvent[] = [];
    for (const ev of nightEvents) {
      const current = tributes.filter(t => t.alive);
      if (current.length <= 1) break;
      const r = resolveEvent(ev, current, roundNumber);
      if (!r) continue;
      nightResolved.push(r);
      applyFatalities(r, tributes, roundNumber);
    }

    // Feast phase (every 5 rounds)
    const feastResolved: ResolvedEvent[] = [];
    if (settings.feastEnabled && dayNumber % 5 === 0) {
      const feastEvents = selectEventsForPhase('feast', tributes.filter(t => t.alive), relMap, 3);
      for (const ev of feastEvents) {
        const current = tributes.filter(t => t.alive);
        if (current.length <= 1) break;
        const r = resolveEvent(ev, current, roundNumber);
        if (!r) continue;
        feastResolved.push(r);
        applyFatalities(r, tributes, roundNumber);
      }
    }

    allRounds.push({
      roundNumber,
      dayPhase: dayResolved,
      nightPhase: nightResolved,
      feastPhase: feastResolved.length > 0 ? feastResolved : undefined,
      survivors: tributes.filter(t => t.alive),
      casualties: tributes.filter(t => !t.alive),
    });

    const alive = tributes.filter(t => t.alive);
    gameOver = alive.length <= 1;
    dayNumber++;
  }

  const winner = tributes.find(t => t.alive);
  const finishTime = new Date().toISOString();

  return {
    id: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    totalRounds: roundNumber,
    winner,
    allRounds,
    tributeStats: tributes.map(t => ({ ...t })),
    metadata: {
      startedAt: startTime,
      finishedAt: finishTime,
      totalDeaths: tributes.filter(t => !t.alive).length,
    },
  };
}

function applyFatalities(event: ResolvedEvent, tributes: Tribute[], round: number): void {
  for (const death of event.deaths) {
    const tribute = tributes.find(t => t.id === death.tributeId);
    if (tribute && tribute.alive) {
      tribute.alive = false;
      tribute.deathRound = round;
      tribute.deathCause = event.cause;
    }
  }

  for (const killer of event.killers) {
    const tribute = tributes.find(t => t.id === killer.tributeId);
    if (tribute) {
      tribute.kills += 1;
    }
  }
}
