# Product Engine

AliExpress link → fully-built Shopify **draft** product (scrape → margin → name → copy → metafields → AI images → draft), brand-agnostic and multi-account.

## What makes brands separate
Every rule that used to be "Brand-specific" lives in the `brands` table as data (voice, palette, naming, pricing, art direction, Shopify store + token). Row Level Security scopes every row to the logged-in user, so accounts and brands never see each other's data. Content is generated on-brand for whichever brand you select.

## Setup
1. Create a Supabase project. In the SQL editor, run `supabase/schema.sql`.
2. Create a Storage bucket if you want cached images (optional for v1).
3. Copy `.env.example` → `.env.local` and fill in:
   - `ANTHROPIC_API_KEY`, `APIFY_TOKEN`, `LOVART_ACCESS_KEY`/`LOVART_SECRET_KEY`
   - Supabase URL + anon + service-role keys
4. `npm install`
5. `npm run dev` → open http://localhost:3000
6. Sign in (magic link), go to **Brand settings**, create a brand (paste its Shopify store + Admin API token, voice, palette, pricing).
7. Add an AliExpress URL to the queue → **Generate** → review images → **Approve & build draft**.

## Deploy
Push to GitHub → import in Vercel → set the same env vars. Shopify creds are per-brand in the DB, not env vars.

## Pipeline (lib/pipeline.js)
scrape → verify_variants → margin(+comps/web search) → name(collision-checked) → copy → images_generate → **[human image gate]** → draft_create → metafields → inventory → report. Every step logs a `run_steps` row; failures show the exact step + detail.

## Notes / to confirm with live keys
- **Lovart** (`lib/lovart.js`): the REST shape is isolated in one file. When you drop in real keys, confirm the upload/chat/result endpoints match; only that file changes if they differ.
- **Inventory step** is a placeholder that marks intent; wire `inventorySetQuantities` to your real variant + location IDs once a brand's store is connected.
- **Images run inline** with `maxDuration=300`. For very large batches, move `images_generate` to a queue/poll worker later — the DB model already supports it.
