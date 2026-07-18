'use client';
// client.js — browser Supabase + an authed fetch helper for API calls.
import { createClient } from '@supabase/supabase-js';

let _sb;
export function sb() {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return _sb;
}

export async function api(path, opts = {}) {
  const { data } = await sb().auth.getSession();
  const token = data?.session?.access_token;
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}`, ...(opts.headers || {}) },
  });
  return res.json();
}
