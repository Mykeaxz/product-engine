// supabase.js — two clients.
// - browserClient: anon key, used in the UI, respects RLS via the user's session.
// - serviceClient: service role, server-only, used by the worker to advance runs.
//   The worker still scopes every query by user_id + brand_id explicitly, so the
//   service role never becomes a way to cross the brand wall.

import { createClient } from '@supabase/supabase-js';

export function browserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function serviceClient() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}
