// Approve/reject/regenerate image candidates, and resume to draft once the
// gate is satisfied (4 gallery + 3 section approved).
import { userFromRequest } from '../../../lib/auth.js';
import { serviceClient } from '../../../lib/supabase.js';
import { resumeAfterImages } from '../../../lib/pipeline.js';

export const maxDuration = 300;

export async function POST(req) {
  const { sb, user, error } = await userFromRequest(req);
  if (error) return json({ error }, 401);
  const body = await req.json();

  if (body.action === 'set_approved') {
    await sb.from('assets').update({ approved: body.approved }).eq('id', body.asset_id);
    return json({ ok: true });
  }

  if (body.action === 'resume') {
    const { data: run } = await sb.from('runs').select('*').eq('id', body.run_id).single();
    const { data: brand } = await sb.from('brands').select('*').eq('id', run.brand_id).single();
    const { data: source } = await sb.from('sources').select('*').eq('id', run.source_id).single();
    const svc = serviceClient();
    try {
      await resumeAfterImages(svc, { brand, source, run });
    } catch (e) {
      return json({ error: String(e.message || e) }, 200);
    }
    return json({ ok: true, status: 'done' });
  }

  return json({ error: 'unknown action' }, 400);
}

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
