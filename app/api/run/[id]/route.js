import { userFromRequest } from '../../../../lib/auth.js';

export async function GET(req, { params }) {
  const { sb, error } = await userFromRequest(req);
  if (error) return json({ error }, 401);
  const { id } = await params;
  const { data: run } = await sb.from('runs').select('*').eq('id', id).single();
  const { data: steps } = await sb.from('run_steps').select('*').eq('run_id', id).order('started_at');
  const { data: assets } = await sb.from('assets').select('*').eq('run_id', id).order('created_at');
  return json({ run, steps: steps || [], assets: assets || [] });
}

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
