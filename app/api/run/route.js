// Creates a run for a source and advances it to the image gate.
// maxDuration is high because copy + image generation take minutes.
import { userFromRequest } from '../../../lib/auth.js';
import { serviceClient } from '../../../lib/supabase.js';
import { runUntilGate } from '../../../lib/pipeline.js';

export const maxDuration = 300;

export async function POST(req) {
  const { sb, user, error } = await userFromRequest(req);
  if (error) return json({ error }, 401);
  const { source_id } = await req.json();

  const { data: source } = await sb.from('sources').select('*').eq('id', source_id).single();
  if (!source) return json({ error: 'source not found' }, 404);
  const { data: brand } = await sb.from('brands').select('*').eq('id', source.brand_id).single();
  if (!brand) return json({ error: 'brand not found' }, 404);

  const { data: run } = await sb.from('runs').insert({
    user_id: user.id, brand_id: brand.id, source_id: source.id, status: 'running',
  }).select().single();
  await sb.from('sources').update({ status: 'running', run_id: run.id }).eq('id', source.id);

  // Service client for the worker (writes across tables); scoped by run.user_id.
  const svc = serviceClient();
  try {
    await runUntilGate(svc, { brand, source, run });
  } catch (e) {
    return json({ run_id: run.id, error: String(e.message || e) }, 200);
  }
  return json({ run_id: run.id, status: 'needs_review' });
}

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
