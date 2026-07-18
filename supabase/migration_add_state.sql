-- Run this in the Supabase SQL editor to support the poll-based pipeline.
-- It adds a scratch column where the engine stores intermediate data between
-- the small worker steps (apify run id, scrape data, chosen variant, lovart jobs).
alter table runs add column if not exists state jsonb default '{}'::jsonb;
