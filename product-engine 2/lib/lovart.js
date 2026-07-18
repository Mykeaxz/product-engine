// lovart.js — start + check split so images can be polled, not blocked.
const BASE = process.env.LOVART_BASE || 'https://api.lovart.ai/v1';

function headers() {
  return {
    'Content-Type': 'application/json',
    'X-Access-Key': process.env.LOVART_ACCESS_KEY,
    'X-Secret-Key': process.env.LOVART_SECRET_KEY,
  };
}

export async function uploadReference(imageUrl) {
  const res = await fetch(`${BASE}/upload`, { method: 'POST', headers: headers(), body: JSON.stringify({ url: imageUrl }) });
  if (!res.ok) throw new Error(`lovart upload ${res.status}`);
  return (await res.json()).id;
}

export async function startGenerate({ prompt, referenceIds }) {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ mode: 'thinking', prompt, references: referenceIds, size: '1080x1080' }),
  });
  if (!res.ok) throw new Error(`lovart generate ${res.status}`);
  return (await res.json()).job_id;
}

// Check one job (fast). Returns { done, ok, images }.
export async function checkJob(jobId) {
  const res = await fetch(`${BASE}/result/${jobId}`, { headers: headers() });
  const data = await res.json();
  if (data.status === 'done') return { done: true, ok: true, images: (data.images || []).map((i) => i.url) };
  if (data.status === 'error') return { done: true, ok: false };
  return { done: false };
}
