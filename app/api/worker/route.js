// Advances one run by one small unit of work, then returns. The client polls
// this until status is needs_review / done / error. Each call is fast.
import { userFromRequest } from '../../../lib/auth.js';
import { serviceClient } from '../../../lib/supabase.js';
import { advance } from '../../../lib/pipeline.js';

export const maxDuration = 120; // a single Claude step can take ~60-90s

export async function POST(req) {
  const { sb, user, error } = await userFromRequest(req);
  if (error) return json({ error }, 401);
  const { run_id } = await req.json();

  // Verify the run belongs to this user (RLS-scoped read).
  const { data: run } = await sb.from('runs').select('id').eq('id', run_id).single();
  if (!run) return json({ error: 'run not found' }, 404);

  const result = await advance(serviceClient(), run_id);
  return json(result);
}

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
