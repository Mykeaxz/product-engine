import { userFromRequest } from '../../../lib/auth.js';
import { serviceClient } from '../../../lib/supabase.js';
import { resumeAfterImages } from '../../../lib/pipeline.js';

export const maxDuration = 120;

export async function POST(req) {
  const { sb, user, error } = await userFromRequest(req);
  if (error) return json({ error }, 401);
  const body = await req.json();

  if (body.action === 'set_approved') {
    await sb.from('assets').update({ approved: body.approved }).eq('id', body.asset_id);
    return json({ ok: true });
  }
  if (body.action === 'resume') {
    const { data: run } = await sb.from('runs').select('id').eq('id', body.run_id).single();
    if (!run) return json({ error: 'run not found' }, 404);
    try {
      const r = await resumeAfterImages(serviceClient(), body.run_id);
      return json({ ok: true, ...r });
    } catch (e) {
      return json({ error: String(e.message || e) }, 200);
    }
  }
  return json({ error: 'unknown action' }, 400);
}

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
