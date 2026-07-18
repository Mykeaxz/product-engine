'use client';
import { useEffect, useState } from 'react';
import { sb, api } from '../lib/client.js';

export default function Dashboard() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [brands, setBrands] = useState([]);
  const [brandId, setBrandId] = useState('');
  const [sources, setSources] = useState([]);
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    sb().auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = sb().auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) loadBrands(); }, [session]);
  useEffect(() => { if (brandId) loadSources(); }, [brandId]);

  async function loadBrands() {
    const { brands } = await api('/api/brands');
    setBrands(brands || []);
    if (brands?.length && !brandId) setBrandId(brands[0].id);
  }
  async function loadSources() {
    const { sources } = await api(`/api/sources?brand_id=${brandId}`);
    setSources(sources || []);
  }
  async function addSource() {
    if (!url) return;
    await api('/api/sources', { method: 'POST', body: JSON.stringify({ brand_id: brandId, url, notes }) });
    setUrl(''); setNotes(''); loadSources();
  }
  async function runSource(id) {
    setBusy(id);
    const r = await api('/api/run', { method: 'POST', body: JSON.stringify({ source_id: id }) });
    setBusy('');
    // Open the run page — it drives the pipeline forward by polling the worker.
    if (r.run_id) window.location.href = `/run/${r.run_id}`;
    else loadSources();
  }
  async function magicLink() {
    await sb().auth.signInWithOtp({ email });
    alert('Check your email for the login link.');
  }

  if (!session) {
    return (
      <div style={wrap}>
        <h1>Product Engine</h1>
        <p style={{ color: '#9aa0ac' }}>Sign in to your account.</p>
        <input style={input} placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button style={btn} onClick={magicLink}>Send magic link</button>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Product Engine</h1>
        <div>
          <a href="/settings" style={link}>Brand settings</a>
          <button style={{ ...btnGhost, marginLeft: 12 }} onClick={() => sb().auth.signOut()}>Sign out</button>
        </div>
      </div>

      {!brands.length ? (
        <p style={{ color: '#9aa0ac' }}>No brand yet. <a href="/settings" style={link}>Create your first brand →</a></p>
      ) : (
        <>
          <div style={{ margin: '16px 0' }}>
            <label style={{ color: '#9aa0ac', marginRight: 8 }}>Brand:</label>
            <select style={input} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          <div style={card}>
            <h3 style={{ marginTop: 0 }}>Add to queue</h3>
            <input style={{ ...input, width: '100%' }} placeholder="AliExpress product URL" value={url} onChange={(e) => setUrl(e.target.value)} />
            <input style={{ ...input, width: '100%', marginTop: 8 }} placeholder="Notes (e.g. 2 sizes queen/king, grey)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <button style={{ ...btn, marginTop: 8 }} onClick={addSource}>Add</button>
          </div>

          <h3>Queue</h3>
          {sources.map((s) => (
            <div key={s.id} style={row}>
              <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={chip(s.status)}>{s.status}</span> {s.aliexpress_url}
              </div>
              {s.run_id && <a href={`/run/${s.run_id}`} style={link}>view</a>}
              {(s.status === 'queued' || s.status === 'error') && (
                <button style={btn} disabled={busy === s.id} onClick={() => runSource(s.id)}>
                  {busy === s.id ? 'running…' : 'Generate'}
                </button>
              )}
              {s.status === 'needs_review' && <a href={`/run/${s.run_id}`} style={btn}>Review images</a>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const wrap = { maxWidth: 820, margin: '40px auto', padding: '0 20px' };
const card = { background: '#171a21', border: '1px solid #262a33', borderRadius: 10, padding: 16, margin: '12px 0' };
const row = { display: 'flex', alignItems: 'center', gap: 12, background: '#171a21', border: '1px solid #262a33', borderRadius: 8, padding: '10px 14px', margin: '8px 0' };
const input = { background: '#0f1115', color: '#e7e9ee', border: '1px solid #2b303a', borderRadius: 6, padding: '8px 10px' };
const btn = { background: '#4f7cff', color: '#fff', border: 0, borderRadius: 6, padding: '8px 14px', cursor: 'pointer' };
const btnGhost = { background: 'transparent', color: '#9aa0ac', border: '1px solid #2b303a', borderRadius: 6, padding: '8px 14px', cursor: 'pointer' };
const link = { color: '#7aa2ff', textDecoration: 'none' };
const chip = (s) => ({ padding: '2px 8px', borderRadius: 999, fontSize: 12, marginRight: 8,
  background: s === 'done' ? '#16351f' : s === 'error' ? '#3a1a1a' : s === 'needs_review' ? '#3a341a' : '#1a2740',
  color: s === 'done' ? '#5fd88a' : s === 'error' ? '#ff8080' : s === 'needs_review' ? '#e6c65f' : '#7aa2ff' });
