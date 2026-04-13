import express from 'express';
import cors from 'cors';
import { runSimulation } from './simulator.js';
import { EVENT_POOL_STATS } from './events.js';
import {
  initSchema,
  saveSimulation, saveTributes, saveEvents,
  listSimulations, countSimulations,
  getFullSimulation, deleteSimulation,
} from './db.js';
import type { SimulationRequest } from './types.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '2mb' }));

// ── Init Neon on startup ───────────────────────────────────
initSchema().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  Arena API running at http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('Failed to init Neon schema:', err);
  process.exit(1);
});

// ── Health check ────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// ── Event pool stats ───────────────────────────────────────
app.get('/api/events/stats', (_req, res) => {
  res.json({ success: true, data: EVENT_POOL_STATS });
});

// ── Simulations CRUD ───────────────────────────────────────
app.get('/api/simulations', async (req, res) => {
  const limit  = Math.min(parseInt(String(req.query.limit  ?? '20')), 100);
  const offset = Math.max(parseInt(String(req.query.offset ?? '0')),   0);
  try {
    const [simulations, total] = await Promise.all([
      listSimulations(limit, offset),
      countSimulations(),
    ]);
    return res.json({ success: true, data: { simulations, total, limit, offset } });
  } catch (err) {
    console.error('[listSimulations]', err);
    return res.status(500).json({ success: false, error: 'Database error.' });
  }
});

app.get('/api/simulations/:id', async (req, res) => {
  try {
    const full = await getFullSimulation(req.params.id);
    if (!full) return res.status(404).json({ success: false, error: 'Not found.' });
    return res.json({ success: true, data: full });
  } catch (err) {
    console.error('[getFullSimulation]', err);
    return res.status(500).json({ success: false, error: 'Database error.' });
  }
});

app.delete('/api/simulations/:id', async (req, res) => {
  try {
    const existing = await getFullSimulation(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Not found.' });
    await deleteSimulation(req.params.id);
    return res.json({ success: true, data: { id: req.params.id } });
  } catch (err) {
    console.error('[deleteSimulation]', err);
    return res.status(500).json({ success: false, error: 'Database error.' });
  }
});

// ── Run simulation ──────────────────────────────────────────
app.post('/api/simulate', async (req, res) => {
  const body = req.body as SimulationRequest;

  if (!body.tributes || !Array.isArray(body.tributes) || body.tributes.length < 2) {
    return res.status(400).json({ success: false, error: 'At least 2 tributes are required.' });
  }
  if (body.tributes.length > 48) {
    return res.status(400).json({ success: false, error: 'Maximum 48 tributes allowed.' });
  }
  for (let i = 0; i < body.tributes.length; i++) {
    if (!body.tributes[i].name?.trim()) {
      return res.status(400).json({ success: false, error: `Tribute ${i + 1} is missing a name.` });
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

    // Persist to Neon
    await saveSimulation({
      id:           result.id,
      startedAt:    result.metadata.startedAt,
      finishedAt:   result.metadata.finishedAt,
      totalRounds:  result.totalRounds,
      totalDeaths:  result.metadata.totalDeaths,
      winnerId:     result.winner?.id,
      winnerName:   result.winner?.name,
    });

    await saveTributes(result.tributeStats.map(t => ({
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
    })));

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

    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[simulate]', err);
    return res.status(500).json({ success: false, error: 'Simulation failed. Please try again.' });
  }
});

// ── 404 catch-all ──────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});
