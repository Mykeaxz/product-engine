import { userFromRequest } from '../../../lib/auth.js';
import { parseProductId } from '../../../lib/apify.js';

export async function POST(req) {
  const { sb, user, error } = await userFromRequest(req);
  if (error) return json({ error }, 401);
  const { brand_id, url, notes } = await req.json();
  if (!brand_id || !url) return json({ error: 'brand_id and url required' }, 400);

  const { data, error: e } = await sb.from('sources').insert({
    user_id: user.id, brand_id, aliexpress_url: url,
    product_id: parseProductId(url), notes: notes || null, status: 'queued',
  }).select().single();
  if (e) return json({ error: e.message }, 400);
  return json({ source: data });
}

export async function GET(req) {
  const { sb, user, error } = await userFromRequest(req);
  if (error) return json({ error }, 401);
  const brandId = new URL(req.url).searchParams.get('brand_id');
  let q = sb.from('sources').select('*').order('created_at', { ascending: false });
  if (brandId) q = q.eq('brand_id', brandId);
  const { data } = await q;
  return json({ sources: data || [] });
}

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
