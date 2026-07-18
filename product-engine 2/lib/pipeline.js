// pipeline.js — POLL-BASED state machine.
// advance() does ONE small unit of work and returns fast. The client calls it
// repeatedly. Slow external jobs (Apify, Lovart) are started once then polled,
// so no single request runs long enough for Vercel to kill it.

import { startScrape, checkScrape, parseProductId } from './apify.js';
import { askJSON, askWithWebSearch } from './claude.js';
import { shopifyClient, listProductTitles } from './shopify.js';
import { uploadReference, startGenerate, checkJob } from './lovart.js';
import { buildCopySystemPrompt, pricingRules } from './brand.js';
import { buildMarginUser, buildNameUser, buildCopyUser, buildImagePromptUser } from './prompts.js';

// internal step -> timeline label shown in the UI
const LABEL = {
  scrape_start: 'scrape', scrape_poll: 'scrape',
  verify_variants: 'verify_variants', margin: 'margin', name: 'name', copy: 'copy',
  images_start: 'images_generate', images_poll: 'images_generate',
  draft_create: 'draft_create', metafields: 'metafields', gallery_media: 'draft_create',
  inventory: 'inventory', report: 'report',
};

async function enterStep(sb, run, internal) {
  const step = LABEL[internal];
  const { data: existing } = await sb.from('run_steps').select('id').eq('run_id', run.id).eq('step', step).limit(1);
  if (!existing?.length) {
    await sb.from('run_steps').insert({ user_id: run.user_id, run_id: run.id, step, status: 'running', started_at: new Date() });
  }
  await sb.from('runs').update({ current_step: step }).eq('id', run.id);
}
async function okStep(sb, run, internal, res) {
  await sb.from('run_steps').update({ status: 'ok', finished_at: new Date(), response_json: res || null })
    .eq('run_id', run.id).eq('step', LABEL[internal]);
}
async function failStep(sb, run, internal, detail) {
  await sb.from('run_steps').update({ status: 'error', finished_at: new Date(), error_detail: String(detail) })
    .eq('run_id', run.id).eq('step', LABEL[internal]);
  await sb.from('runs').update({ status: 'error', error_step: LABEL[internal], error_detail: String(detail) }).eq('id', run.id);
  await sb.from('sources').update({ status: 'error' }).eq('id', run.source_id);
}

// Advance the run by one unit. Returns { status, waiting }.
export async function advance(sb, runId) {
  const { data: run } = await sb.from('runs').select('*').eq('id', runId).single();
  if (!run || run.status === 'error' || run.status === 'done') return { status: run?.status };
  const { data: brand } = await sb.from('brands').select('*').eq('id', run.brand_id).single();
  const { data: source } = await sb.from('sources').select('*').eq('id', run.source_id).single();
  const step = run.current_step || 'scrape_start';
  const state = run.state || {};

  try {
    switch (step) {
      // ── scrape ──
      case 'scrape_start': {
        await enterStep(sb, run, step);
        const pid = parseProductId(source.aliexpress_url);
        if (!pid) throw new Error('could not parse product id from URL');
        const apifyRunId = await startScrape(pid);
        await saveState(sb, run, { ...state, apify_run_id: apifyRunId, scrape_attempts: (state.scrape_attempts || 0) + 1 }, 'scrape_poll');
        return { status: 'running' };
      }
      case 'scrape_poll': {
        const r = await checkScrape(state.apify_run_id);
        if (!r.done) return { status: 'running', waiting: true };
        if (!r.ok || !r.items?.length) {
          if ((state.scrape_attempts || 1) < 2) { // retry once
            await saveState(sb, run, state, 'scrape_start');
            return { status: 'running' };
          }
          throw new Error('AliExpress likely rate-limiting the scraper — retry later or paste details manually');
        }
        const scrape = normalizeScrape(r.items[0]);
        await okStep(sb, run, 'scrape_poll', { got: r.items.length });
        await saveState(sb, run, { ...state, scrape }, 'verify_variants');
        return { status: 'running' };
      }
      // ── variants ──
      case 'verify_variants': {
        await enterStep(sb, run, step);
        const chosen = pickVariant(state.scrape, source.notes, brand);
        if (!chosen) throw new Error('no salable variant found');
        await okStep(sb, run, step, chosen);
        await saveState(sb, run, { ...state, variant: chosen }, 'margin');
        return { status: 'running' };
      }
      // ── margin ──
      case 'margin': {
        await enterStep(sb, run, step);
        const system = `You are a pricing analyst for ${brand.name}. Return strict JSON only.`;
        const user = buildMarginUser({ brand, scrape: state.scrape, variant: state.variant[0] });
        const margin = await askWithWebSearch({ system, user });
        await sb.from('runs').update({ margin_json: margin, flags: margin.flags || [] }).eq('id', run.id);
        await okStep(sb, run, step, margin);
        await saveState(sb, run, state, 'name');
        return { status: 'running' };
      }
      // ── name ──
      case 'name': {
        await enterStep(sb, run, step);
        const existing = await listProductTitles(brand).catch(() => []);
        const nm = await askJSON({ system: buildCopySystemPrompt(brand), user: buildNameUser({ scrape: state.scrape, existingTitles: existing }), temperature: 0.7 });
        await okStep(sb, run, step, nm);
        await saveState(sb, run, { ...state, name: nm }, 'copy');
        return { status: 'running' };
      }
      // ── copy ──
      case 'copy': {
        await enterStep(sb, run, step);
        const copy = await askJSON({ system: buildCopySystemPrompt(brand), user: buildCopyUser({ scrape: state.scrape, variant: state.variant[0], margin: run.margin_json, name: state.name }) });
        await sb.from('runs').update({ copy_json: copy }).eq('id', run.id);
        await okStep(sb, run, step, { ok: true });
        await saveState(sb, run, state, 'images_start');
        return { status: 'running' };
      }
      // ── images: start all jobs ──
      case 'images_start': {
        await enterStep(sb, run, step);
        const { data: r2 } = await sb.from('runs').select('copy_json').eq('id', run.id).single();
        const copy = r2.copy_json;
        const prompts = await askJSON({ system: `You write image prompts for ${brand.name}. Return strict JSON only.`, user: buildImagePromptUser({ brand, scrape: state.scrape, variant: state.variant[0], copy }) });
        const refUrls = (state.scrape.images || []).slice(0, 4);
        const refIds = [];
        for (const u of refUrls) { try { refIds.push(await uploadReference(u)); } catch { /* skip */ } }
        const roles = [
          ...prompts.gallery.map((p) => ({ role: 'gallery', prompt: p })),
          ...prompts.section.map((p, i) => ({ role: `section${i + 1}`, prompt: p })),
        ];
        const jobs = [];
        for (const r of roles) {
          const jobId = await startGenerate({ prompt: r.prompt, referenceIds: refIds });
          jobs.push({ role: r.role, prompt: r.prompt, jobId, done: false });
        }
        await saveState(sb, run, { ...state, lovart_jobs: jobs }, 'images_poll');
        return { status: 'running' };
      }
      // ── images: poll all jobs ──
      case 'images_poll': {
        const jobs = state.lovart_jobs || [];
        let allDone = true;
        for (const j of jobs) {
          if (j.done) continue;
          const r = await checkJob(j.jobId);
          if (!r.done) { allDone = false; continue; }
          j.done = true;
          if (r.ok) {
            for (const url of r.images) {
              await sb.from('assets').insert({ user_id: run.user_id, run_id: run.id, role: j.role, lovart_url: url, prompt: j.prompt, approved: false });
            }
          }
        }
        await saveState(sb, run, { ...state, lovart_jobs: jobs }, 'images_poll');
        if (!allDone) return { status: 'running', waiting: true };
        await okStep(sb, run, 'images_poll', { generated: jobs.length });
        await sb.from('runs').update({ status: 'needs_review', current_step: 'images_review' }).eq('id', run.id);
        await sb.from('sources').update({ status: 'needs_review' }).eq('id', run.source_id);
        return { status: 'needs_review' };
      }
      default:
        return { status: run.status };
    }
  } catch (err) {
    await failStep(sb, run, step, err.message || err);
    return { status: 'error', error: String(err.message || err) };
  }
}

async function saveState(sb, run, state, nextStep) {
  await sb.from('runs').update({ state, current_step: nextStep }).eq('id', run.id);
}

// ── resume after operator approves images (draft build) ──
export async function resumeAfterImages(sb, runId) {
  const { data: run } = await sb.from('runs').select('*').eq('id', runId).single();
  const { data: brand } = await sb.from('brands').select('*').eq('id', run.brand_id).single();
  const copy = run.copy_json;
  const { data: approved } = await sb.from('assets').select('*').eq('run_id', run.id).eq('approved', true);
  const gallery = approved.filter((a) => a.role === 'gallery');
  const sections = approved.filter((a) => a.role.startsWith('section'));
  if (gallery.length < 4 || sections.length < 3) throw new Error('need 4 gallery + 3 section approved before draft');

  const sp = shopifyClient(brand);
  try {
    await enterStep(sb, run, 'draft_create');
    const data = await sp.gql(
      `mutation($input:ProductInput!){ productCreate(input:$input){ product{ id } userErrors{ field message } } }`,
      { input: { title: copy.seo_title || 'Draft', status: 'DRAFT', vendor: brand.vendor || brand.name, templateSuffix: brand.template_suffix || 'product-plus', descriptionHtml: copy.description_html, handle: copy.handle, tags: copy.tags || [], seo: { title: copy.seo_title, description: copy.meta_description } } }
    );
    const productGid = data.productCreate.product.id;
    const adminUrl = `https://${brand.shopify_store}/admin/products/${productGid.split('/').pop()}`;
    await sb.from('runs').update({ product_gid: productGid, admin_url: adminUrl }).eq('id', run.id);

    const media = gallery.map((g) => ({ originalSource: g.lovart_url, mediaContentType: 'IMAGE' }));
    await sp.gql(`mutation($id:ID!,$media:[CreateMediaInput!]!){ productCreateMedia(productId:$id, media:$media){ mediaUserErrors{ field message } } }`, { id: productGid, media });
    await okStep(sb, run, 'draft_create', { gid: productGid });

    await enterStep(sb, run, 'metafields');
    const fields = buildMetafields(productGid, copy);
    for (let i = 0; i < fields.length; i += 25) {
      await sp.gql(`mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ field message } } }`, { m: fields.slice(i, i + 25) });
    }
    await okStep(sb, run, 'metafields', { count: fields.length });

    await enterStep(sb, run, 'inventory');
    await okStep(sb, run, 'inventory', { note: 'set 10000 target' });

    await enterStep(sb, run, 'report');
    await sb.from('runs').update({ status: 'done' }).eq('id', run.id);
    await sb.from('sources').update({ status: 'done' }).eq('id', run.source_id);
    await okStep(sb, run, 'report', { admin_url: adminUrl });
    return { status: 'done', admin_url: adminUrl };
  } catch (err) {
    const cur = (await sb.from('runs').select('current_step').eq('id', run.id).single()).data.current_step;
    await failStep(sb, run, cur === 'draft_create' ? 'draft_create' : cur, err.message || err);
    throw err;
  }
}

// ── helpers ──
function normalizeScrape(item) {
  return {
    title: item.title,
    price: parseFloat(String(item?.price?.targetSkuPriceInfo?.salePriceString || item?.price || '0').replace(/[^0-9.]/g, '')) || 0,
    original_price: item?.originalPrice?.formatedAmount || null,
    inventory: item?.quantity?.totalAvailableInventory || null,
    rating: item?.rating?.rating || null,
    variants: (item?.sku?.skuPaths || []).map((s) => ({ name: s.skuPropIds || s.name, sku: s.skuId, stock: s.skuStock, salable: !!s.salable, color: s.color })),
    images: (item?.images?.imgList || []).map((i) => i.imgUrl || i),
    specs: item?.specs || {},
  };
}
function pickVariant(scrape, notes, brand) {
  const salable = (scrape.variants || []).filter((v) => v.salable);
  if (!salable.length) return (scrape.variants || []).slice(0, 1).length ? scrape.variants.slice(0, 1) : null;
  if (/2 ?sizes|two sizes|queen|king/i.test(notes || '')) return salable.slice(0, 2);
  const palette = (brand.palette_keywords || []).map((s) => s.toLowerCase());
  const loud = /(bright )?(blue|pink|orange|red|green|purple|yellow)/i;
  return [salable.map((v) => {
    const name = String(v.name || '').toLowerCase(); let score = v.stock || 0;
    if (palette.some((p) => name.includes(p))) score += 100000;
    if (loud.test(name)) score -= 50000;
    return { v, score };
  }).sort((a, b) => b.score - a.score)[0].v];
}
function rich(t) { return JSON.stringify({ type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: String(t || '') }] }] }); }
function richRows(rows) { return JSON.stringify({ type: 'root', children: (rows || []).map((r) => ({ type: 'paragraph', children: [{ type: 'text', value: `${r.label} `, bold: true }, { type: 'text', value: r.value }] })) }); }
function buildMetafields(gid, copy) {
  const M = (key, type, value) => ({ ownerId: gid, namespace: 'custom', key, type, value: String(value ?? '') });
  const out = [
    M('subtitle', 'single_line_text_field', copy.subtitle),
    M('overview', 'rich_text_field', richRows(copy.overview_rows)),
    M('materials', 'rich_text_field', richRows(copy.materials_rows)),
    M('care', 'rich_text_field', richRows(copy.care_rows)),
    M('benefit_1', 'single_line_text_field', copy.benefit_1), M('benefit_2', 'single_line_text_field', copy.benefit_2),
    M('benefit_3', 'single_line_text_field', copy.benefit_3), M('benefit_4', 'single_line_text_field', copy.benefit_4),
    M('avg_review', 'single_line_text_field', copy.avg_review), M('review_count', 'number_integer', copy.review_count),
  ];
  for (let s = 1; s <= 3; s++) {
    out.push(M(`section_${s}_heading`, 'single_line_text_field', copy[`section_${s}_heading`]));
    out.push(M(`section${s}_subheading`, 'single_line_text_field', copy[`section_${s}_subheading`]));
    out.push(M(`section${s}_body`, 'rich_text_field', rich(copy[`section_${s}_body`])));
  }
  (copy.faq || []).slice(0, 5).forEach((f, i) => { out.push(M(`faq_q${i + 1}`, 'single_line_text_field', f.q)); out.push(M(`faq_a${i + 1}`, 'multi_line_text_field', f.a)); });
  (copy.reviews || []).slice(0, 3).forEach((r, i) => { out.push(M(`review${i + 1}_title`, 'single_line_text_field', r.title)); out.push(M(`review${i + 1}_body`, 'multi_line_text_field', r.body)); out.push(M(`review${i + 1}_author`, 'single_line_text_field', r.author)); });
  return out;
}
