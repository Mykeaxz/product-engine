'use client';
import { useEffect, useState } from 'react';
import { sb, api } from '../../lib/client.js';

const BLANK = {
  name: '', shopify_store: '', shopify_admin_token: '', vendor: '', template_suffix: 'product-plus',
  naming_pattern: '{brand} {OneWord}™ {descriptor}',
  palette: 'soft grey, cream, warm neutral, sand, coffee',
  tone: 'calm, declarative, confident, short sentences, no hype, no exclamation marks',
  prefer: 'engineered, structured, considered, holds, aligned, intentional',
  avoid: 'cheap, cozy-vibes, medical-white-coat',
  art: 'warm quiet-luxury (Hermès-style): golden-hour light, honey/caramel/cream/terracotta, tactile linen + wool + oak + ceramics, 1-2 considered props, shallow depth of field, generous whitespace, no text/graphics/arrows, US-market models, varied faces',
};

export default function Settings() {
  const [session, setSession] = useState(null);
  const [brands, setBrands] = useState([]);
  const [f, setF] = useState(BLANK);
  const [msg, setMsg] = useState('');

  useEffect(() => { sb().auth.getSession().then(({ data }) => setSession(data.session)); }, []);
  useEffect(() => { if (session) load(); }, [session]);

  async function load() { const { brands } = await api('/api/brands'); setBrands(brands || []); }
  function edit(b) {
    setF({
      id: b.id, name: b.name || '', shopify_store: b.shopify_store || '', shopify_admin_token: b.shopify_admin_token || '',
      vendor: b.vendor || '', template_suffix: b.template_suffix || 'product-plus',
      naming_pattern: b.naming_pattern || BLANK.naming_pattern,
      palette: (b.palette_keywords || []).join(', '),
      tone: b.voice_profile?.tone || '', prefer: (b.voice_profile?.prefer || []).join(', '), avoid: (b.voice_profile?.avoid || []).join(', '),
      art: b.art_direction?.preset || '',
    });
  }
  async function save() {
    const payload = {
      id: f.id, name: f.name, shopify_store: f.shopify_store, shopify_admin_token: f.shopify_admin_token,
      vendor: f.vendor || f.name, template_suffix: f.template_suffix, naming_pattern: f.naming_pattern,
      palette_keywords: f.palette.split(',').map((s) => s.trim()).filter(Boolean),
      voice_profile: { tone: f.tone, prefer: split(f.prefer), avoid: split(f.avoid) },
      art_direction: { preset: f.art },
    };
    const r = await api('/api/brands', { method: 'POST', body: JSON.stringify(payload) });
    if (r.error) { setMsg('Error: ' + r.error); return; }
    setMsg('Saved ✓'); setF(BLANK); load();
  }
  async function testShopify() {
    setMsg('Testing connection…');
    const r = await api('/api/brands', { method: 'POST', body: JSON.stringify({ action: 'test', shopify_store: f.shopify_store, shopify_admin_token: f.shopify_admin_token }) });
    setMsg(r.ok ? `Connected ✓ ${r.shop}` : '✗ ' + r.error);
  }

  if (!session) return <div style={wrap}><a href="/" style={link}>← sign in first</a></div>;

  return (
    <div style={wrap}>
      <a href="/" style={link}>← queue</a>
      <h1>Brands</h1>
      <p style={{ color: '#9aa0ac' }}>Each brand is fully separate — its own voice, palette, pricing and Shopify store. Content is always generated on-brand for whichever you select.</p>

      {brands.map((b) => (
        <div key={b.id} style={row}>
          <div style={{ flex: 1 }}><b>{b.name}</b> <span style={{ color: '#9aa0ac' }}>{b.shopify_store || 'no store'}</span></div>
          <button style={btnGhost} onClick={() => edit(b)}>Edit</button>
        </div>
      ))}

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>{f.id ? 'Edit brand' : 'New brand'}</h3>
        <Field label="Brand name" v={f.name} on={(v) => setF({ ...f, name: v })} />
        <Field label="Shopify store (xxx.myshopify.com)" v={f.shopify_store} on={(v) => setF({ ...f, shopify_store: v })} />
        <Field label="Shopify Admin API token (shpat_…)" v={f.shopify_admin_token} on={(v) => setF({ ...f, shopify_admin_token: v })} />
        <button style={{ ...btnGhost, marginBottom: 4 }} onClick={testShopify}>Test Shopify connection</button>
        <Field label="Vendor" v={f.vendor} on={(v) => setF({ ...f, vendor: v })} />
        <Field label="Template suffix" v={f.template_suffix} on={(v) => setF({ ...f, template_suffix: v })} />
        <Field label="Naming pattern" v={f.naming_pattern} on={(v) => setF({ ...f, naming_pattern: v })} />
        <Field label="Palette keywords (comma-sep)" v={f.palette} on={(v) => setF({ ...f, palette: v })} />
        <Area label="Voice — tone" v={f.tone} on={(v) => setF({ ...f, tone: v })} />
        <Field label="Voice — prefer words" v={f.prefer} on={(v) => setF({ ...f, prefer: v })} />
        <Field label="Voice — avoid words" v={f.avoid} on={(v) => setF({ ...f, avoid: v })} />
        <Area label="Image art direction" v={f.art} on={(v) => setF({ ...f, art: v })} />
        <button style={{ ...btn, marginTop: 10 }} onClick={save}>{f.id ? 'Save changes' : 'Create brand'}</button>
        {f.id && <button style={{ ...btnGhost, marginLeft: 8 }} onClick={() => setF(BLANK)}>Cancel</button>}
        {msg && <span style={{ marginLeft: 12, color: '#5fd88a' }}>{msg}</span>}
      </div>
    </div>
  );
}

const split = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
function Field({ label, v, on }) {
  return <div style={{ margin: '8px 0' }}><label style={lbl}>{label}</label><input style={{ ...input, width: '100%' }} value={v} onChange={(e) => on(e.target.value)} /></div>;
}
function Area({ label, v, on }) {
  return <div style={{ margin: '8px 0' }}><label style={lbl}>{label}</label><textarea style={{ ...input, width: '100%', minHeight: 70 }} value={v} onChange={(e) => on(e.target.value)} /></div>;
}

const wrap = { maxWidth: 820, margin: '40px auto', padding: '0 20px' };
const card = { background: '#171a21', border: '1px solid #262a33', borderRadius: 10, padding: 16, margin: '16px 0' };
const row = { display: 'flex', alignItems: 'center', gap: 12, background: '#171a21', border: '1px solid #262a33', borderRadius: 8, padding: '10px 14px', margin: '6px 0' };
const input = { background: '#0f1115', color: '#e7e9ee', border: '1px solid #2b303a', borderRadius: 6, padding: '8px 10px', boxSizing: 'border-box', fontFamily: 'inherit' };
const lbl = { display: 'block', color: '#9aa0ac', fontSize: 13, marginBottom: 4 };
const btn = { background: '#4f7cff', color: '#fff', border: 0, borderRadius: 6, padding: '9px 16px', cursor: 'pointer' };
const btnGhost = { background: 'transparent', color: '#9aa0ac', border: '1px solid #2b303a', borderRadius: 6, padding: '8px 14px', cursor: 'pointer' };
const link = { color: '#7aa2ff', textDecoration: 'none' };
