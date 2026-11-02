import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { keyAwareFetch } from "@/lib/supabase-fetch";

// Helpers for the API routes in src/app/api. These only ever run on the server.

function publicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase is not set up on the server.");
  return { url, key };
}

/**
 * Works out who is calling an API route from the "Authorization: Bearer <token>" header the
 * browser sends. Returns a Supabase client that acts as that user (so the database rules
 * still apply), or null if the token is missing or invalid.
 */
export async function authenticate(
  request: Request,
): Promise<{ supabase: SupabaseClient; user: User } | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const { url, key } = publicConfig();
  const supabase = createClient(url, key, {
    global: { fetch: keyAwareFetch(key), headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { supabase, user: data.user };
}

/** A client that bypasses the database rules. Only for server routes nobody signs in to (the M-Pesa callback). */
export function adminClient(): SupabaseClient {
  const { url } = publicConfig();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");
  return createClient(url, serviceKey, {
    global: { fetch: keyAwareFetch(serviceKey) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}
