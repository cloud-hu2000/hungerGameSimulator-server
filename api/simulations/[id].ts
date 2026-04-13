import { getFullSimulation, deleteSimulation } from '../../lib/db.js';

export default async function handler(req: Request, { params }: { params: { id: string } }) {
  const { id } = params;

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method === 'GET') {
    try {
      const full = await getFullSimulation(id);
      if (!full) {
        return new Response(
          JSON.stringify({ success: false, error: 'Not found.' }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          },
        );
      }
      return new Response(
        JSON.stringify({ success: true, data: full }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        },
      );
    } catch (err) {
      console.error('[getFullSimulation]', err);
      return new Response(
        JSON.stringify({ success: false, error: 'Database error.' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        },
      );
    }
  }

  if (req.method === 'DELETE') {
    try {
      const existing = await getFullSimulation(id);
      if (!existing) {
        return new Response(
          JSON.stringify({ success: false, error: 'Not found.' }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          },
        );
      }
      await deleteSimulation(id);
      return new Response(
        JSON.stringify({ success: true, data: { id } }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        },
      );
    } catch (err) {
      console.error('[deleteSimulation]', err);
      return new Response(
        JSON.stringify({ success: false, error: 'Database error.' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        },
      );
    }
  }

  return new Response(
    JSON.stringify({ success: false, error: 'Method not allowed.' }),
    {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Allow': 'GET, DELETE', 'Access-Control-Allow-Origin': '*' },
    },
  );
}
