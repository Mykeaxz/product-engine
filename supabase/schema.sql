-- Product Engine — schema
-- Every table is scoped by user_id + brand_id. RLS enforces isolation so
-- one brand's content can never bleed into another's.

-- ─────────────────────────────────────────────────────────────
-- brands: everything that was "Kopflo-specific" lives here as data.
-- A user can own one or many brands; a run always targets exactly one.
-- ─────────────────────────────────────────────────────────────
create table if not exists brands (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  created_at        timestamptz not null default now(),
  name              text not null,

  -- Shopify connection (per brand, never a global env var)
  shopify_store     text,                    -- e.g. kopflo.myshopify.com
  shopify_admin_token text,                  -- encrypted at rest; per brand
  shopify_api_version text default '2025-01',
  template_suffix   text default 'product-plus',
  vendor            text,                    -- Shopify vendor name

  -- Brand brain — drives the Claude system prompt
  voice_profile     jsonb default '{}'::jsonb,  -- tone, preferred/banned words
  naming_pattern    text,                    -- e.g. "{brand} {OneWord}™ {descriptor}"
  palette_keywords  text[] default '{}',     -- soft grey / cream / sand
  art_direction     jsonb default '{}'::jsonb,-- image art-direction preset

  -- Pricing rules (were hardcoded +$10 / 3× / .90)
  pricing_config    jsonb default '{
    "safety_margin": 10,
    "min_multiple": 3,
    "min_net": 15,
    "price_ending": 0.90,
    "compare_at_gap_min": 15,
    "compare_at_gap_max": 30
  }'::jsonb
);

-- ─────────────────────────────────────────────────────────────
-- sources: the sourcing queue
-- ─────────────────────────────────────────────────────────────
create table if not exists sources (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  brand_id       uuid not null references brands(id) on delete cascade,
  created_at     timestamptz not null default now(),
  aliexpress_url text not null,
  product_id     text,                       -- parsed from URL
  notes          text,                       -- "2 sizes queen/king, grey"
  status         text not null default 'queued'
                 check (status in ('queued','running','needs_review','done','error')),
  run_id         uuid
);

-- ─────────────────────────────────────────────────────────────
-- runs: one per generation attempt
-- ─────────────────────────────────────────────────────────────
create table if not exists runs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  brand_id     uuid not null references brands(id) on delete cascade,
  source_id    uuid not null references sources(id) on delete cascade,
  created_at   timestamptz not null default now(),
  status       text not null default 'running'
               check (status in ('running','needs_review','done','error')),
  current_step text,
  product_gid  text,                         -- Shopify draft GID
  admin_url    text,
  margin_json  jsonb,
  copy_json    jsonb,                         -- generated copy pack
  flags        text[] default '{}',
  error_step   text,
  error_detail text
);

-- ─────────────────────────────────────────────────────────────
-- run_steps: granular log for the timeline UI
-- ─────────────────────────────────────────────────────────────
create table if not exists run_steps (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  run_id        uuid not null references runs(id) on delete cascade,
  step          text not null,   -- scrape | verify_variants | margin | comps |
                                  -- name | copy | images_generate | images_review |
                                  -- draft_create | metafields | inventory | report
  status        text not null default 'pending'
                check (status in ('pending','running','ok','error')),
  started_at    timestamptz,
  finished_at   timestamptz,
  request_json  jsonb,
  response_json jsonb,
  error_detail  text
);

-- ─────────────────────────────────────────────────────────────
-- assets: reference + generated images
-- ─────────────────────────────────────────────────────────────
create table if not exists assets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  run_id           uuid not null references runs(id) on delete cascade,
  role             text not null,  -- ref | gallery | section1 | section2 | section3
  lovart_url       text,
  storage_path     text,
  prompt           text,
  approved         boolean default false,
  shopify_media_gid text,
  created_at       timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────
create index if not exists brands_user_idx     on brands(user_id);
create index if not exists sources_brand_idx    on sources(brand_id, status);
create index if not exists runs_source_idx       on runs(source_id);
create index if not exists run_steps_run_idx     on run_steps(run_id);
create index if not exists assets_run_idx        on assets(run_id, role);

-- ─────────────────────────────────────────────────────────────
-- Row Level Security — the wall between brands/accounts
-- Every row is only visible to the user that owns it.
-- ─────────────────────────────────────────────────────────────
alter table brands    enable row level security;
alter table sources   enable row level security;
alter table runs      enable row level security;
alter table run_steps enable row level security;
alter table assets    enable row level security;

create policy brands_own    on brands    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy sources_own   on sources   for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy runs_own      on runs      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy run_steps_own on run_steps for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy assets_own    on assets    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
