import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { keyAwareFetch } from "@/lib/supabase-fetch";

// The browser client. It is created the first time something uses it, not when the file loads,
// so a missing environment variable shows a clear message instead of breaking the build.
let client: SupabaseClient | undefined;

function getClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not set up. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in your Vercel project settings, then redeploy.",
    );
  }
  client = createClient(url, key, {
    global: { fetch: keyAwareFetch(key) },
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const real = getClient();
    const value = Reflect.get(real, prop);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
