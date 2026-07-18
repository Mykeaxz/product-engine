'use client';
import { useEffect, useState } from 'react';
import { use } from 'react';
import { api } from '../../../lib/client.js';

export default function RunPage({ params }) {
  const { id } = use(params);
  const [run, setRun] = useState(null);
  const [steps, setSteps] = useState([]);
  const [assets, setAssets] = useState([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    const d = await api(`/api/run/${id}`);
    setRun(d.run); setSteps(d.steps || []); setAssets(d.assets || []);
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
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

  const gallery = assets.filter((a) => a.role === 'gallery');
  const sections = assets.filter((a) => a.role.startsWith('section'));
  const approvedG = gallery.filter((a) => a.approved).length;
  const approvedS = sections.filter((a) => a.approved).length;
  const gateReady = approvedG >= 4 && approvedS >= 3;

  return (
    <div style={wrap}>
      <a href="/" style={link}>← queue</a>
      <h1>Run {run.status === 'done' ? '✓' : run.status}</h1>
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

      {run.status === 'needs_review' && (
        <>
          <h3>Image review gate — approve 4 gallery + 3 section</h3>
          <p style={{ color: '#9aa0ac' }}>Approved: {approvedG}/4 gallery, {approvedS}/3 section</p>
          <ImgGrid title="Gallery" items={gallery} onToggle={toggle} />
          <ImgGrid title="Sections" items={sections} onToggle={toggle} />
          <button style={{ ...btn, marginTop: 12, opacity: gateReady ? 1 : 0.4 }} disabled={!gateReady || busy} onClick={resume}>
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
