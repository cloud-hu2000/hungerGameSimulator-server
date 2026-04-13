import { listSimulations, countSimulations } from '../../lib/db.js';

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  const url = new URL(req.url);
  const limit  = Math.min(parseInt(String(url.searchParams.get('limit')  ?? '20')), 100);
  const offset = Math.max(parseInt(String(url.searchParams.get('offset') ?? '0')),   0);

  try {
    const [simulations, total] = await Promise.all([
      listSimulations(limit, offset),
      countSimulations(),
    ]);
    return new Response(
      JSON.stringify({ success: true, data: { simulations, total, limit, offset } }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  } catch (err) {
    console.error('[listSimulations]', err);
    return new Response(
      JSON.stringify({ success: false, error: 'Database error.' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }
}
