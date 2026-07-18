'use client';
import { useEffect, useState, useRef } from 'react';
import { use } from 'react';
import { api } from '../../../lib/client.js';

export default function RunPage({ params }) {
  const { id } = use(params);
  const [run, setRun] = useState(null);
  const [steps, setSteps] = useState([]);
  const [assets, setAssets] = useState([]);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);

  async function load() {
    const d = await api(`/api/run/${id}`);
    setRun(d.run); setSteps(d.steps || []); setAssets(d.assets || []);
    return d.run;
  }

  // Drive the pipeline forward: while status is 'running', keep calling the worker.
  useEffect(() => {
    let stop = false;
    async function tick() {
      const r = await load();
      if (stop || !r) return;
      if (r.status === 'running' && !working.current) {
        working.current = true;
        try { await api('/api/worker', { method: 'POST', body: JSON.stringify({ run_id: id }) }); }
        finally { working.current = false; }
      }
    }
    tick();
    const t = setInterval(tick, 3000);
    return () => { stop = true; clearInterval(t); };
  }, [id]);

  async function toggle(a) {
    await api('/api/approve', { method: 'POST', body: JSON.stringify({ action: 'set_approved', asset_id: a.id, approved: !a.approved }) });
    load();
  }
  async function resume() {
    setBusy(true);
    const r = await api('/api/approve', { method: 'POST', body: JSON.stringify({ action: 'resume', run_id: id }) });
    setBusy(false);
    if (r.error) alert(r.error);
    load();
  }

  if (!run) return <div style={wrap}>Loading…</div>;

  const hero = assets.filter((a) => a.role === 'hero');
  const gallery = assets.filter((a) => a.role === 'gallery');
  const sections = assets.filter((a) => a.role.startsWith('section'));
  const approvedCount = assets.filter((a) => a.approved).length;

  return (
    <div style={wrap}>
      <a href="/" style={link}>← queue</a>
      <h1>Run — {run.status === 'done' ? '✓ done' : run.status}{run.status === 'running' && run.current_step ? ` (${run.current_step}…)` : ''}</h1>
      {run.admin_url && <p><a href={run.admin_url} style={link} target="_blank">Open Shopify draft →</a></p>}
      {run.margin_json && (
        <div style={card}>
          <b>Price:</b> ${run.margin_json.final_price} &nbsp; <b>Compare-at:</b> ${run.margin_json.compare_at} &nbsp;
          <b>Multiple:</b> {run.margin_json.multiple}× {run.margin_json.passes_3x ? '✓' : '⚠ under 3×'}
          {run.flags?.length ? <div style={{ color: '#e6c65f', marginTop: 6 }}>⚠ {run.flags.join(' · ')}</div> : null}
        </div>
      )}

      <h3>Timeline</h3>
      {steps.map((s) => (
        <div key={s.id} style={{ ...row, borderLeft: `3px solid ${s.status === 'ok' ? '#5fd88a' : s.status === 'error' ? '#ff8080' : '#4f7cff'}` }}>
          <div style={{ flex: 1 }}>
            <b>{s.step}</b> <span style={{ color: '#9aa0ac' }}>{s.status}</span>
            {s.error_detail && <div style={{ color: '#ff8080', fontSize: 13, marginTop: 4 }}>{s.error_detail}</div>}
          </div>
        </div>
      ))}
      {run.status === 'running' && <p style={{ color: '#9aa0ac' }}>Working… this page advances the run automatically, keep it open.</p>}

      {run.status === 'needs_review' && (
        <>
          <h3>Image review — approve the images you want on the draft</h3>
          <p style={{ color: '#9aa0ac' }}>{approvedCount} approved — only approved images are attached; you can build with any selection</p>
          {hero.length > 0 && <ImgGrid title="Hero" items={hero} onToggle={toggle} />}
          <ImgGrid title="Gallery" items={gallery} onToggle={toggle} />
          <ImgGrid title="Sections" items={sections} onToggle={toggle} />
          <button style={{ ...btn, marginTop: 12 }} disabled={busy} onClick={resume}>
            {busy ? 'Building draft…' : 'Approve & build Shopify draft'}
          </button>
        </>
      )}
    </div>
  );
}

function ImgGrid({ title, items, onToggle }) {
  return (
    <div style={{ margin: '12px 0' }}>
      <div style={{ color: '#9aa0ac', marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {items.map((a) => (
          <div key={a.id} onClick={() => onToggle(a)} style={{ cursor: 'pointer', border: `2px solid ${a.approved ? '#5fd88a' : '#2b303a'}`, borderRadius: 8, overflow: 'hidden' }}>
            <img src={a.lovart_url} alt={a.role} style={{ width: '100%', display: 'block' }} />
            <div style={{ fontSize: 11, padding: 4, color: a.approved ? '#5fd88a' : '#9aa0ac' }}>{a.role} {a.approved ? '✓' : ''}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const wrap = { maxWidth: 820, margin: '40px auto', padding: '0 20px' };
const card = { background: '#171a21', border: '1px solid #262a33', borderRadius: 10, padding: 16, margin: '12px 0' };
const row = { display: 'flex', gap: 12, background: '#171a21', border: '1px solid #262a33', borderRadius: 8, padding: '10px 14px', margin: '6px 0' };
const btn = { background: '#4f7cff', color: '#fff', border: 0, borderRadius: 6, padding: '10px 16px', cursor: 'pointer' };
const link = { color: '#7aa2ff', textDecoration: 'none' };
