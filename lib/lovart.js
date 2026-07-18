// lovart.js — Lovart OpenAPI (lgw.lovart.ai), HMAC-signed per request.
// Start + check split so images can be polled, not blocked.
// Shapes verified against the official lovartai/lovart-skill client.
import { createHmac, randomUUID } from 'crypto';

const BASE = process.env.LOVART_BASE || 'https://lgw.lovart.ai';
const PREFIX = '/v1/openapi';

// Signature covers method + path (no query string) + unix-seconds timestamp.
function signedHeaders(method, path) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', process.env.LOVART_SECRET_KEY)
    .update(`${method}\n${path}\n${ts}`)
    .digest('hex');
  return {
    'X-Access-Key': process.env.LOVART_ACCESS_KEY,
    'X-Timestamp': ts,
    'X-Signature': sig,
    'X-Signed-Method': method,
    'X-Signed-Path': path,
  };
}

// All responses use a {code, message, data} envelope; code 0 = ok.
async function request(method, path, { body, params } = {}) {
  let url = `${BASE}${path}`;
  if (params) url += `?${new URLSearchParams(params)}`;
  const headers = { ...signedHeaders(method, path), 'Content-Type': 'application/json' };
  if (method === 'POST') headers['Idempotency-Key'] = randomUUID();
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`lovart ${method} ${path} ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  if (json.code !== undefined && json.code !== 0) throw new Error(`lovart ${path}: ${json.message || 'error'} (code ${json.code})`);
  return json.data ?? json;
}

// One Lovart project per run; all generation threads are grouped under it.
export async function createProject() {
  const data = await request('POST', `${PREFIX}/project/save`, {
    body: { project_id: '', canvas: '', project_cover_list: [], pic_count: 0, project_type: 3 },
  });
  return data.project_id;
}

// Pull the source image and re-upload it to Lovart's CDN; the returned URL
// is what /chat accepts as an attachment.
export async function uploadReference(imageUrl) {
  const img = await fetch(imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!img.ok) throw new Error(`reference fetch ${img.status}`);
  const buf = Buffer.from(await img.arrayBuffer());
  const filename = ((imageUrl.split('/').pop() || 'ref.jpg').split('?')[0]) || 'ref.jpg';
  const boundary = randomUUID().replace(/-/g, '');
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const path = `${PREFIX}/file/upload`;
  const headers = { ...signedHeaders('POST', path), 'Content-Type': `multipart/form-data; boundary=${boundary}` };
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: Buffer.concat([head, buf, tail]) });
  const json = await res.json();
  if (!res.ok || json.code !== 0) throw new Error(`lovart upload ${res.status}: ${json.message || ''}`);
  return json.data.url;
}

// Start one generation thread. Returns thread_id.
export async function startGenerate({ prompt, referenceIds, projectId }) {
  const body = { prompt, project_id: projectId };
  if (referenceIds?.length) body.attachments = referenceIds;
  const data = await request('POST', `${PREFIX}/chat`, { body });
  return data.thread_id;
}

// Check one thread (fast). Returns { done, ok, images }.
// A thread can finish "done" with no artifacts (e.g. moderation refusal) —
// that counts as a failed job, not a crash.
export async function checkJob(threadId) {
  const s = await request('GET', `${PREFIX}/chat/status`, { params: { thread_id: threadId } });
  if (s.status === 'abort') return { done: true, ok: false };
  if (s.status !== 'done') return { done: false };
  const result = await request('GET', `${PREFIX}/chat/result`, { params: { thread_id: threadId } });
  const images = (result.items || [])
    .flatMap((it) => it.artifacts || [])
    .filter((a) => a.type === 'image' && a.content)
    .map((a) => a.content);
  return { done: true, ok: images.length > 0, images };
}
