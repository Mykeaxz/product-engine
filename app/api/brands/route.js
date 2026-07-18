// Create / list / update brands. Each brand carries its own voice, palette,
// pricing and Shopify creds — the whole basis of clean per-brand separation.
import { userFromRequest } from '../../../lib/auth.js';
import { shopifyClient } from '../../../lib/shopify.js';

export async function GET(req) {
  const { sb, user, error } = await userFromRequest(req);
  if (error) return json({ error }, 401);
  const { data } = await sb.from('brands').select('*').order('created_at');
  return json({ brands: data || [] });
}

export async function POST(req) {
  const { sb, user, error } = await userFromRequest(req);
  if (error) return json({ error }, 401);
  const b = await req.json();

  // Connection check: verifies store domain + token without saving anything.
  if (b.action === 'test') {
    try {
      const { gql } = shopifyClient(b);
      const data = await gql(`{ shop { name myshopifyDomain currencyCode } }`);
      return json({ ok: true, shop: `${data.shop.name} (${data.shop.myshopifyDomain}, ${data.shop.currencyCode})` });
    } catch (e) {
      return json({ error: String(e.message || e) });
    }
  }

  const row = { user_id: user.id, ...sanitize(b) };
  let res;
  if (b.id) res = await sb.from('brands').update(sanitize(b)).eq('id', b.id).select().single();
  else res = await sb.from('brands').insert(row).select().single();
  if (res.error) return json({ error: res.error.message }, 400);
  return json({ brand: res.data });
}

function sanitize(b) {
  const allow = ['name', 'shopify_store', 'shopify_admin_token', 'shopify_api_version',
    'template_suffix', 'vendor', 'voice_profile', 'naming_pattern', 'palette_keywords',
    'art_direction', 'pricing_config'];
  const out = {};
  for (const k of allow) if (b[k] !== undefined) out[k] = b[k];
  return out;
}

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
