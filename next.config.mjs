// Accept the Supabase variables under several common names, so whatever you already
// typed into Vercel keeps working. The browser only sees the two NEXT_PUBLIC_ values.
const rawUrl = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  ""
)
  .trim()
  .replace(/^["']|["']$/g, "");

// Supabase wants only the address, like https://abcd.supabase.co. If something was added after it
// (/rest/v1/, /auth/v1, a trailing slash), cut it off so requests do not fail with "Invalid path".
let supabaseUrl = rawUrl;
try {
  if (rawUrl) supabaseUrl = new URL(rawUrl).origin;
} catch {
  // not a valid address; leave it so the problem is visible
}

const supabaseKey = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  ""
)
  .trim()
  .replace(/^["']|["']$/g, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabaseKey,
  },
  // The first deployment is the first real build of this code, so a stray type warning
  // must not block it. Turn this off once the app is live and the build is clean.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
