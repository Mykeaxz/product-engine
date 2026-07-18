// auth.js — resolve the logged-in user from the request's bearer token and
// return a Supabase client bound to that user, so RLS enforces brand isolation.
import { createClient } from '@supabase/supabase-js';

export async function userFromRequest(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: 'no token' };

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } }
  );
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return { error: 'invalid token' };
  return { sb, user: data.user };
}
