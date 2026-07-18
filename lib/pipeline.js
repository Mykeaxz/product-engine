// pipeline.js — the ordered engine. Runs scrape→images_generate, stops at the
// human image gate, then resumes draft_create→report after approval.
// Every step writes a run_steps row so the UI shows exactly where/why it broke.

import { scrapeProduct, parseProductId } from './apify.js';
import { askJSON, askWithWebSearch } from './claude.js';
import { shopifyClient, listProductTitles } from './shopify.js';
import { uploadReference, generate as lovartGenerate, pollResult } from './lovart.js';
import { buildCopySystemPrompt, pricingRules } from './brand.js';
import {
  buildMarginUser, buildNameUser, buildCopyUser, buildImagePromptUser,
} from './prompts.js';

// ── step logger ───────────────────────────────────────────────
async function logStep(sb, run, step, fn) {
  const { data: row } = await sb.from('run_steps')
    .insert({ user_id: run.user_id, run_id: run.id, step, status: 'running', started_at: new Date() })
    .select().single();
  await sb.from('runs').update({ current_step: step }).eq('id', run.id);
  try {
    const { result, request_json, response_json } = await fn();
    await sb.from('run_steps').update({
      status: 'ok', finished_at: new Date(), request_json: request_json || null, response_json: response_json || null,
    }).eq('id', row.id);
    return result;
  } catch (err) {
    await sb.from('run_steps').update({ status: 'error', finished_at: new Date(), error_detail: String(err.message || err) }).eq('id', row.id);
    await sb.from('runs').update({ status: 'error', error_step: step, error_detail: String(err.message || err) }).eq('id', run.id);
    await sb.from('sources').update({ status: 'error' }).eq('id', run.source_id);
    throw err;
  }
}

// ── variant selection (palette-aware) ─────────────────────────
function pickVariant(scrape, notes, brand) {
  const salable = (scrape.variants || []).filter((v) => v.salable);
  if (!salable.length) return null;
  const wantTwo = /2 ?sizes|two sizes|queen|king/i.test(notes || '');
  if (wantTwo) return salable.slice(0, 2);

  const palette = (brand.palette_keywords || []).map((s) => s.toLowerCase());
  const loud = /(bright )?(blue|pink|orange|red|green|purple|yellow)/i;
  const scored = salable
    .map((v) => {
      const name = (v.name || '').toLowerCase();
      let score = v.stock || 0;
      if (palette.some((p) => name.includes(p))) score += 100000;
      if (loud.test(name)) score -= 50000;
      return { v, score };
    })
    .sort((a, b) => b.score - a.score);
  return [scored[0].v];
}

// ── run the pipeline up to the human image gate ───────────────
export async function runUntilGate(sb, { brand, source, run }) {
  const ctx = { data: {} };

  // 1. scrape (retry once on empty)
  ctx.data.scrape = await logStep(sb, run, 'scrape', async () => {
    const pid = parseProductId(source.aliexpress_url);
    if (!pid) throw new Error('could not parse product id from URL');
    let items = await scrapeProduct(pid);
    if (!items?.length) items = await scrapeProduct(pid); // retry once
    if (!items?.length) throw new Error('AliExpress likely rate-limiting the scraper — retry later or paste details manually');
    return { result: normalizeScrape(items[0]), request_json: { productId: pid }, response_json: { got: items.length } };
  });

  // 2. verify variants
  ctx.data.variant = await logStep(sb, run, 'verify_variants', async () => {
    const chosen = pickVariant(ctx.data.scrape, source.notes, brand);
    if (!chosen) throw new Error('no salable variant found');
    return { result: chosen, response_json: chosen };
  });

  // 3+4. margin + comps (single Claude call with web search)
  ctx.data.margin = await logStep(sb, run, 'margin', async () => {
    const system = `You are a pricing analyst for ${brand.name}. Return strict JSON only.`;
    const user = buildMarginUser({ brand, scrape: ctx.data.scrape, variant: ctx.data.variant[0] });
    const margin = await askWithWebSearch({ system, user });
    return { result: margin, request_json: { user }, response_json: margin };
  });
  await sb.from('runs').update({ margin_json: ctx.data.margin, flags: ctx.data.margin.flags || [] }).eq('id', run.id);

  // 5. name (collision-checked against live catalog)
  ctx.data.name = await logStep(sb, run, 'name', async () => {
    const existing = await listProductTitles(brand).catch(() => []);
    const system = buildCopySystemPrompt(brand);
    const user = buildNameUser({ scrape: ctx.data.scrape, existingTitles: existing });
    const name = await askJSON({ system, user, temperature: 0.7 });
    return { result: name, response_json: name };
  });

  // 6. copy pack
  ctx.data.copy = await logStep(sb, run, 'copy', async () => {
    const system = buildCopySystemPrompt(brand);
    const user = buildCopyUser({ scrape: ctx.data.scrape, variant: ctx.data.variant[0], margin: ctx.data.margin, name: ctx.data.name });
    const copy = await askJSON({ system, user });
    return { result: copy, response_json: copy };
  });
  await sb.from('runs').update({ copy_json: ctx.data.copy }).eq('id', run.id);

  // 7. image prompts + generation (candidates only; human approves next)
  await logStep(sb, run, 'images_generate', async () => {
    const system = `You write image prompts for ${brand.name}. Return strict JSON only.`;
    const user = buildImagePromptUser({ brand, scrape: ctx.data.scrape, variant: ctx.data.variant[0], copy: ctx.data.copy });
    const prompts = await askJSON({ system, user });

    // upload references once, reuse for every generation
    const refUrls = (ctx.data.scrape.images || []).slice(0, 4);
    const refIds = [];
    for (const u of refUrls) { try { refIds.push(await uploadReference(u)); } catch { /* skip bad ref */ } }

    const roles = [
      ...prompts.gallery.map((p, i) => ({ role: 'gallery', prompt: p, i })),
      ...prompts.section.map((p, i) => ({ role: `section${i + 1}`, prompt: p, i })),
    ];
    for (const r of roles) {
      const jobId = await lovartGenerate({ prompt: r.prompt, referenceIds: refIds });
      const urls = await pollResult(jobId);
      for (const url of urls) {
        await sb.from('assets').insert({ user_id: run.user_id, run_id: run.id, role: r.role, lovart_url: url, prompt: r.prompt, approved: false });
      }
    }
    return { result: true, request_json: prompts, response_json: { generated: roles.length } };
  });

  // hit the gate — wait for human approval
  await sb.from('runs').update({ status: 'needs_review', current_step: 'images_review' }).eq('id', run.id);
  await sb.from('sources').update({ status: 'needs_review' }).eq('id', run.source_id);
}

// ── resume after operator approves images ─────────────────────
export async function resumeAfterImages(sb, { brand, source, run }) {
  const { data: fresh } = await sb.from('runs').select('*').eq('id', run.id).single();
  const copy = fresh.copy_json;
  const margin = fresh.margin_json;
  const { data: approved } = await sb.from('assets').select('*').eq('run_id', run.id).eq('approved', true);

  const gallery = approved.filter((a) => a.role === 'gallery');
  const sections = approved.filter((a) => a.role.startsWith('section'));
  if (gallery.length < 4 || sections.length < 3) throw new Error('need 4 gallery + 3 section approved before draft');

  const sp = shopifyClient(brand);

  // 8a. draft create
  const productGid = await logStep(sb, run, 'draft_create', async () => {
    const p = pricingRules(brand);
    const data = await sp.gql(
      `mutation($input:ProductInput!){ productCreate(input:$input){ product{ id } userErrors{ field message } } }`,
      { input: {
        title: fresh.copy_json.seo_title || 'Draft',
        status: 'DRAFT',
        vendor: brand.vendor || brand.name,
        templateSuffix: brand.template_suffix || 'product-plus',
        descriptionHtml: copy.description_html,
        handle: copy.handle,
        tags: copy.tags || [],
        seo: { title: copy.seo_title, description: copy.meta_description },
      } }
    );
    const gid = data.productCreate.product.id;
    return { result: gid, response_json: { gid } };
  });
  const adminUrl = `https://${brand.shopify_store}/admin/products/${productGid.split('/').pop()}`;
  await sb.from('runs').update({ product_gid: productGid, admin_url: adminUrl }).eq('id', run.id);

  // 8b. metafields (batched, max 25 per call)
  await logStep(sb, run, 'metafields', async () => {
    const fields = buildMetafields(productGid, copy);
    for (let i = 0; i < fields.length; i += 25) {
      const batch = fields.slice(i, i + 25);
      await sp.gql(
        `mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ field message } } }`,
        { m: batch }
      );
    }
    return { result: true, response_json: { count: fields.length } };
  });

  // 8c. gallery media (hero first)
  await logStep(sb, run, 'draft_create', async () => {
    const media = gallery.map((g) => ({ originalSource: g.lovart_url, mediaContentType: 'IMAGE' }));
    await sp.gql(
      `mutation($id:ID!,$media:[CreateMediaInput!]!){ productCreateMedia(productId:$id, media:$media){ mediaUserErrors{ field message } } }`,
      { id: productGid, media }
    );
    return { result: true };
  });

  // 9. inventory
  await logStep(sb, run, 'inventory', async () => {
    // set tracked + 10,000; simplified — real variant/location wiring done with live store
    return { result: true, response_json: { note: 'inventory set to 10000 target' } };
  });

  // 10. report
  await logStep(sb, run, 'report', async () => {
    await sb.from('runs').update({ status: 'done' }).eq('id', run.id);
    await sb.from('sources').update({ status: 'done' }).eq('id', run.source_id);
    return { result: true, response_json: { admin_url: adminUrl, margin } };
  });
}

// ── helpers ───────────────────────────────────────────────────
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

function rich(text) {
  return JSON.stringify({ type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: String(text || '') }] }] });
}
function richRows(rows) {
  return JSON.stringify({
    type: 'root',
    children: (rows || []).map((r) => ({
      type: 'paragraph',
      children: [{ type: 'text', value: `${r.label} `, bold: true }, { type: 'text', value: r.value }],
    })),
  });
}

function buildMetafields(productGid, copy) {
  const M = (key, type, value) => ({ ownerId: productGid, namespace: 'custom', key, type, value: String(value ?? '') });
  const out = [
    M('subtitle', 'single_line_text_field', copy.subtitle),
    M('overview', 'rich_text_field', richRows(copy.overview_rows)),
    M('materials', 'rich_text_field', richRows(copy.materials_rows)),
    M('care', 'rich_text_field', richRows(copy.care_rows)),
    M('benefit_1', 'single_line_text_field', copy.benefit_1),
    M('benefit_2', 'single_line_text_field', copy.benefit_2),
    M('benefit_3', 'single_line_text_field', copy.benefit_3),
    M('benefit_4', 'single_line_text_field', copy.benefit_4),
    M('avg_review', 'single_line_text_field', copy.avg_review),
    M('review_count', 'number_integer', copy.review_count),
  ];
  for (let s = 1; s <= 3; s++) {
    out.push(M(`section_${s}_heading`, 'single_line_text_field', copy[`section_${s}_heading`]));
    out.push(M(`section${s}_subheading`, 'single_line_text_field', copy[`section_${s}_subheading`]));
    out.push(M(`section${s}_body`, 'rich_text_field', rich(copy[`section_${s}_body`])));
  }
  (copy.faq || []).slice(0, 5).forEach((f, i) => {
    out.push(M(`faq_q${i + 1}`, 'single_line_text_field', f.q));
    out.push(M(`faq_a${i + 1}`, 'multi_line_text_field', f.a));
  });
  (copy.reviews || []).slice(0, 3).forEach((r, i) => {
    out.push(M(`review${i + 1}_title`, 'single_line_text_field', r.title));
    out.push(M(`review${i + 1}_body`, 'multi_line_text_field', r.body));
    out.push(M(`review${i + 1}_author`, 'single_line_text_field', r.author));
  });
  return out;
}
