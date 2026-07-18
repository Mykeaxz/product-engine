// apify.js — split into start + check so the pipeline can POLL instead of
// blocking one long request (Vercel kills long requests).
const ACTOR = 'coladeu/aliexpress-product-details';
const BASE = 'https://api.apify.com/v2';

export function parseProductId(url) {
  const m = String(url).match(/(\d{6,})/);
  return m ? m[1] : null;
}

// Kick off a run, return the run id immediately (fast).
export async function startScrape(productId) {
  const token = process.env.APIFY_TOKEN;
  const input = { productIds: [productId], location: 'US', locale: 'en_US', currency: 'USD' };
  const res = await fetch(`${BASE}/acts/${ACTOR.replace('/', '~')}/runs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`apify start ${res.status}: ${await res.text()}`);
  return (await res.json()).data.id;
}

// Check a run once (fast). Returns { done, ok, items }.
export async function checkScrape(runId) {
  const token = process.env.APIFY_TOKEN;
  const poll = await fetch(`${BASE}/actor-runs/${runId}`, { headers: { Authorization: `Bearer ${token}` } });
  const status = (await poll.json()).data.status;
  if (status === 'RUNNING' || status === 'READY') return { done: false };
  if (status !== 'SUCCEEDED') return { done: true, ok: false, status };
  const items = await fetch(`${BASE}/actor-runs/${runId}/dataset/items`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  return { done: true, ok: true, items };
}
