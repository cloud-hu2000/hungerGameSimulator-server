import type { SimulationRequest } from '../src/types.js';
import { runSimulation } from '../lib/simulator.js';
import {
  saveSimulation, saveTributes, saveEvents,
} from '../lib/db.js';

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed.' }),
      {
        status: 405,
        headers: {
          'Content-Type': 'application/json',
          'Allow': 'POST',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        },
      },
    );
  }

  let body: SimulationRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid JSON body.' }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': 'true',
        },
      },
    );
  }

  if (!body.tributes || !Array.isArray(body.tributes) || body.tributes.length < 2) {
    return new Response(
      JSON.stringify({ success: false, error: 'At least 2 tributes are required.' }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': 'true',
        },
      },
    );
  }
  if (body.tributes.length > 48) {
    return new Response(
      JSON.stringify({ success: false, error: 'Maximum 48 tributes allowed.' }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': 'true',
        },
      },
    );
  }
  for (let i = 0; i < body.tributes.length; i++) {
    if (!body.tributes[i].name?.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: `Tribute ${i + 1} is missing a name.` }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Credentials': 'true',
          },
        },
      );
    }
  }

  const settings = {
    deathsPerRound: body.settings?.deathsPerRound ?? 0,
    startOnDay:     body.settings?.startOnDay     ?? 0,
    maxRounds:      body.settings?.maxRounds      ?? 50,
    feastEnabled:   body.settings?.feastEnabled   ?? true,
  };

  try {
    const result = runSimulation({ ...body, settings });

    // Persist to Neon (non-blocking if DB is unavailable)
    await Promise.all([
      saveSimulation({
        id:           result.id,
        startedAt:    result.metadata.startedAt,
        finishedAt:   result.metadata.finishedAt,
        totalRounds:  result.totalRounds,
        totalDeaths:  result.metadata.totalDeaths,
        winnerId:     result.winner?.id,
        winnerName:   result.winner?.name,
      }),
      saveTributes(result.tributeStats.map(t => ({
        id:           t.id,
        simulationId: result.id,
        name:         t.name,
        pronouns:     t.pronouns,
        imageUrl:     t.imageUrl,
        district:     t.district,
        skills:       t.skills,
        alive:        t.alive,
        deathRound:   t.deathRound,
        deathCause:   t.deathCause === 'alive' ? undefined : t.deathCause,
        kills:        t.kills,
      }))),
    ]);

    const allEvents = result.allRounds.flatMap(round => [
      ...(round.bloodbathPhase ?? []),
      ...round.dayPhase,
      ...round.nightPhase,
      ...(round.feastPhase ?? []),
    ]);

    await saveEvents(allEvents.map((e, idx) => ({
      id:           `${result.id}-e${idx}`,
      simulationId: result.id,
      round:        e.round,
      stage:        e.stage,
      message:      e.message,
      isFatal:      e.isFatal,
      deaths:       e.deaths,
      killers:      e.killers,
      tags:         e.tags,
      cause:        e.cause,
    })));

    return new Response(
      JSON.stringify({ success: true, data: result }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': 'true',
        },
      },
    );
  } catch (err) {
    console.error('[simulate]', err);
    return new Response(
      JSON.stringify({ success: false, error: 'Simulation failed. Please try again.' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': 'true',
        },
      },
    );
  }
}
