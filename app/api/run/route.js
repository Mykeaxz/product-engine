// Creates a run and returns immediately. The client then drives it forward by
// calling /api/worker repeatedly — no long-running request here.
import { userFromRequest } from '../../../lib/auth.js';

export async function POST(req) {
  const { sb, user, error } = await userFromRequest(req);
  if (error) return json({ error }, 401);
  const { source_id } = await req.json();

  const { data: source } = await sb.from('sources').select('*').eq('id', source_id).single();
  if (!source) return json({ error: 'source not found' }, 404);
  const { data: brand } = await sb.from('brands').select('*').eq('id', source.brand_id).single();
  if (!brand) return json({ error: 'brand not found' }, 404);

  const { data: run } = await sb.from('runs').insert({
    user_id: user.id, brand_id: brand.id, source_id: source.id,
    status: 'running', current_step: 'scrape_start', state: {},
  }).select().single();
  await sb.from('sources').update({ status: 'running', run_id: run.id }).eq('id', source.id);

  return json({ run_id: run.id });
}

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
