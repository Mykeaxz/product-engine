// apify.js — scrape one AliExpress product via the documented actor.
const ACTOR = 'coladeu/aliexpress-product-details';
const BASE = 'https://api.apify.com/v2';

export function parseProductId(url) {
  const m = String(url).match(/(\d{6,})/);
  return m ? m[1] : null;
}

// Runs the actor, polls to completion, returns dataset items (raw).
export async function scrapeProduct(productId) {
  const token = process.env.APIFY_TOKEN;
  const input = { productIds: [productId], location: 'US', locale: 'en_US', currency: 'USD' };

  const startRes = await fetch(`${BASE}/acts/${ACTOR.replace('/', '~')}/runs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!startRes.ok) throw new Error(`apify start ${startRes.status}: ${await startRes.text()}`);
  const run = (await startRes.json()).data;

  // Poll the run
  const deadline = Date.now() + 90_000;
  let status = run.status;
  while (status === 'RUNNING' || status === 'READY') {
    if (Date.now() > deadline) throw new Error('apify run timed out');
    await sleep(3000);
    const poll = await fetch(`${BASE}/actor-runs/${run.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    status = (await poll.json()).data.status;
  }
  if (status !== 'SUCCEEDED') throw new Error(`apify run ${status}`);

  const items = await fetch(
    `${BASE}/actor-runs/${run.id}/dataset/items`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then((r) => r.json());

  return items; // caller checks items.length === 0 and retries once
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
