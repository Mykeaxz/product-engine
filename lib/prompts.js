// prompts.js — user-message builders + the strict JSON schema for the copy pack.
// System prompts come from lib/brand.js. These build the per-run user messages.

import { pricingRules, buildArtDirection, paletteKeywords } from './brand.js';

export function buildMarginUser({ brand, scrape, variant }) {
  const p = pricingRules(brand);
  return `Compute pricing for this product. Use web search for real retail comps (Amazon/DTC) if needed.
Source price (USD): ${scrape.price}
Chosen variant: ${variant?.name || 'n/a'}
Category/title: ${scrape.title}

RULES:
- Landed cost = source price + a reasonable US shipping estimate.
- Target price must be >= ${p.min_multiple}x landed AND >= $${p.min_net} net after shipping.
- If it fails ${p.min_multiple}x, search real comps. Price at the top of the TRUE comp band; never against a premium outlier. If comps don't support it, price at the ceiling and flag it.
- Round final price to a ${p.price_ending} ending.
- Add $${p.safety_margin} safety margin on top of the calculated price.
- Set compare-at above price, gap ~$${p.compare_at_gap_min}-${p.compare_at_gap_max}.

Return STRICT JSON:
{"source":num,"shipping_est":num,"landed":num,"calc_price":num,"final_price":num,"compare_at":num,"multiple":num,"net":num,"passes_3x":bool,"comps":[{"name":str,"price":num}],"flags":[str]}`;
}

export function buildNameUser({ scrape, existingTitles }) {
  return `Product: ${scrape.title}
Existing catalog names (avoid collisions): ${existingTitles.join(', ') || '(none)'}
Return STRICT JSON: {"one_word":str,"descriptor":str,"full_name":str}
The one_word must not collide (case-insensitive) with any existing name.`;
}

export function buildCopyUser({ scrape, variant, margin, name }) {
  return `Build the full copy pack for this product. Use ONLY facts present in the source.
Title: ${scrape.title}
Chosen variant: ${variant?.name || 'single'} (color/size as applicable)
Real source numbers available: ${JSON.stringify(scrape.specs || {})}
Product name: ${name.full_name}
Price: ${margin.final_price}  Compare-at: ${margin.compare_at}

Return STRICT JSON matching EXACTLY this shape:
${COPY_SCHEMA}`;
}

export function buildImagePromptUser({ brand, scrape, variant, copy }) {
  return `Write the Lovart image prompts for this product. Three batches: 1 hero, 4 gallery, 3 section.
Product: ${copy.seo_title || scrape.title}
True color of chosen variant: ${variant?.color || 'as shown in references'}
Art direction (apply to every prompt): ${buildArtDirection(brand)}
Palette: ${paletteKeywords(brand)}

The hero is the main e-commerce packshot: the exact product from the reference photos, centered and fully visible on a clean brand-palette backdrop, soft studio light, premium mockup quality, nothing covering the product.
Each prompt MUST encode all 8 rules:
1) Square 1:1 1080x1080. 2) Exact dimensions + physical scale anchor. 3) Correct primary function/placement (section body text must match its image). 4) No zipper/hardware close-ups. 5) Warm quiet-luxury art direction, no text/graphics/arrows, varied faces. 6) Explicit cross-section geometry for odd shapes. 7) Correct true color. 8) (human approves later).
Section prompts must match the section body copy:
- section1 body: ${copy.section_1_body}
- section2 body: ${copy.section_2_body}
- section3 body: ${copy.section_3_body}

Return STRICT JSON: {"hero":str,"gallery":[str,str,str,str],"section":[str,str,str]}`;
}

// The exact copy pack shape the app stores + maps to metafields.
export const COPY_SCHEMA = `{
  "description_html": "hook line + one mechanism sentence + exactly 3 bold-lead bullets",
  "subtitle": "product + primary pain-point keyword",
  "seo_title": "string",
  "meta_description": "~150 chars",
  "handle": "long-tail-hyphenated",
  "overview_rows": [{"label":"What it is:","value":"..."}],
  "materials_rows": [{"label":"Core","value":"..."}],
  "care_rows": [{"label":"Cover","value":"..."}],
  "benefit_1":"<=18 chars","benefit_2":"<=18 chars","benefit_3":"<=18 chars","benefit_4":"<=18 chars",
  "section_1_heading":"","section_1_subheading":"","section_1_body":"",
  "section_2_heading":"","section_2_subheading":"","section_2_body":"",
  "section_3_heading":"","section_3_subheading":"","section_3_body":"",
  "faq":[{"q":"","a":""}],
  "reviews":[{"title":"","body":"","author":""}],
  "avg_review":"4.8","review_count":137,
  "tags":["use-...","func-..."]
}`;
