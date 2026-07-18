// brand.js — turns a brand record into the rules + system prompt the pipeline uses.
// Nothing here is hardcoded to Kopflo. Every brand supplies its own profile,
// so the same engine produces clean, on-brand content for whoever is logged in.

// A brand profile is expected to look like this (all editable in Settings):
//
// {
//   name: "Kopflo",
//   vendor: "Kopflo",
//   naming_pattern: "{brand} {OneWord}™ {descriptor}",
//   palette_keywords: ["soft grey","cream","warm neutral","sand","coffee"],
//   voice_profile: {
//     tone: "calm, declarative, confident, short sentences, no hype, no exclamation marks",
//     prefer: ["engineered","structured","considered","holds","aligned","intentional"],
//     avoid:  ["cheap","cozy-vibes","medical-white-coat"]
//   },
//   art_direction: {
//     preset: "warm quiet-luxury (Hermès-style): golden-hour light, honey/caramel/cream/terracotta,
//              tactile linen + wool + oak + ceramics, 1-2 considered props, shallow depth of field,
//              generous whitespace, no text/graphics/arrows, US-market models, varied faces"
//   },
//   pricing_config: { safety_margin:10, min_multiple:3, min_net:15, price_ending:0.90,
//                     compare_at_gap_min:15, compare_at_gap_max:30 }
// }

export function pricingRules(brand) {
  return {
    safety_margin: 10,
    min_multiple: 3,
    min_net: 15,
    price_ending: 0.9,
    compare_at_gap_min: 15,
    compare_at_gap_max: 30,
    ...(brand.pricing_config || {}),
  };
}

// The universal honesty + format rules. These do NOT change per brand —
// they are the quality floor that applies to every product.
const HONESTY_RULES = `
HONESTY (never break these):
- Never invent facts. No made-up dimensions, materials, certifications, or bonuses.
- If the source doesn't state it, don't claim it — even if the listing advertises a free gift/bonus, never promise it.
- Keep medical caveats honest (e.g. sleep apnea is not a CPAP replacement; advise consulting a doctor for diagnosed conditions).
`;

const COPY_FORMAT_RULES = `
COPY FORMAT (strict):
- Description: bold hook line, one mechanism sentence using real numbers from the source, then exactly 3 bold-lead bullets (structural claim first, benefit second). Nothing more.
- Subtitle: product + primary pain-point keyword.
- SEO title + meta description (~150 chars) + long-tail handle.
- Overview: bold-led rows (e.g. "What it is:", "Who it's for:") — scannable, never a text wall.
- Materials: bold-led rows (Core / Cover / Construction).
- Care: bold-led rows (Cover / Foam core / On arrival / Storage).
- 4 benefit chips: hard, searchable, purchase-driving benefits ONLY, each <= 18 characters. Never sizes/logistics.
- 3 section blocks (heading + subheading + body): 1=primary function, 2=secondary use/versatility, 3=build/simplicity. Body text must match what its image will show.
- 5 FAQ pairs: real buyer questions, honest answers.
- 3 placeholder reviews at three different angles, clearly placeholder for the operator to swap.
- Placeholder rating: avg 4.7-4.9, review_count integer 50-250.
`;

// Build the system prompt for the COPY call from a brand record.
export function buildCopySystemPrompt(brand) {
  const v = brand.voice_profile || {};
  const tone = v.tone || 'calm, clear, confident';
  const prefer = (v.prefer || []).join(', ') || '(none specified)';
  const avoid = (v.avoid || []).join(', ') || '(none specified)';
  const pattern = brand.naming_pattern || '{brand} {OneWord} {descriptor}';

  return `You are the senior copywriter and product operator for the brand "${brand.name}".
Everything you produce must sound unmistakably like ${brand.name} — never generic.

VOICE:
- Tone: ${tone}
- Prefer words: ${prefer}
- Avoid words: ${avoid}

NAMING PATTERN: ${pattern.replace('{brand}', brand.name)}
- One-word name, calm/evocative. It will be collision-checked against ${brand.name}'s live catalog.
${HONESTY_RULES}
${COPY_FORMAT_RULES}
OUTPUT: return STRICT JSON only, matching the schema you are given. No prose, no markdown fences.`;
}

// Build the art-direction block injected into every image prompt for this brand.
export function buildArtDirection(brand) {
  const preset = brand.art_direction?.preset;
  if (preset) return preset;
  // Neutral fallback if a brand hasn't set one yet.
  return 'clean, warm, natural light, tactile natural materials, generous whitespace, no text/graphics/arrows overlays, varied models';
}

export function paletteKeywords(brand) {
  return (brand.palette_keywords || []).join(', ') || '(no palette set — pick a calm neutral)';
}
