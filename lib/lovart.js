// lovart.js — image generation client.
// NOTE: Lovart's exact REST shape is confirmed against their API when you drop
// in real keys; endpoints below are isolated here so only this file changes if
// the shape differs. Everything else in the pipeline talks to these functions.

const BASE = process.env.LOVART_BASE || 'https://api.lovart.ai/v1';

function headers() {
  return {
    'Content-Type': 'application/json',
    'X-Access-Key': process.env.LOVART_ACCESS_KEY,
    'X-Secret-Key': process.env.LOVART_SECRET_KEY,
  };
}

// Upload a reference image URL, return a Lovart reference id.
export async function uploadReference(imageUrl) {
  const res = await fetch(`${BASE}/upload`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ url: imageUrl }),
  });
  if (!res.ok) throw new Error(`lovart upload ${res.status}: ${await res.text()}`);
  return (await res.json()).id;
}

// Start a generation with the prompt + reference ids re-attached (model drifts without them).
export async function generate({ prompt, referenceIds }) {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ mode: 'thinking', prompt, references: referenceIds, size: '1080x1080' }),
  });
  if (!res.ok) throw new Error(`lovart generate ${res.status}: ${await res.text()}`);
  return (await res.json()).job_id;
}

// Poll a generation job to completion, return image URLs.
export async function pollResult(jobId) {
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/result/${jobId}`, { headers: headers() });
    const data = await res.json();
    if (data.status === 'done') return data.images.map((i) => i.url);
    if (data.status === 'error') throw new Error('lovart job error: ' + (data.error || ''));
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('lovart job timed out');
}
