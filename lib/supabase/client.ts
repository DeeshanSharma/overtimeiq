import { createBrowserClient } from '@supabase/ssr';

// Singleton browser client — use this in client components and Zustand stores.
// Cookie-based session handled automatically by @supabase/ssr.
let client: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowserClient() {
  if (client) return client;

  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );

  return client;
}
