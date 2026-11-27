/**
 * Server-only Alibaba / DashScope key resolution.
 *
 * Priority:
 *   1. Supabase `api_keys` row with provider = 'alibaba' AND is_active = true.
 *   2. Server env `ALIBABA_API_KEY`, then `VITE_ALIBABA_API_KEY`.
 *
 * The browser must never supply this key: API routes resolve it here, via the
 * service-role client, so no client-side secret is required or trusted.
 *
 * Apply `supabase/api_keys_table.sql` to create the table. Without
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY this module simply uses env vars.
 */
import { createClient } from '@supabase/supabase-js';

const CACHE_TTL_MS = 60_000;

interface CachedKey {
  key: string;
  expiresAt: number;
}

let cached: CachedKey | null = null;
let pending: Promise<string> | null = null;

function envKey(): string {
  return (
    process.env.ALIBABA_API_KEY ||
    process.env.VITE_ALIBABA_API_KEY ||
    ''
  ).trim();
}

async function readDbKey(): Promise<string | null> {
  const url = (process.env.SUPABASE_URL || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceRoleKey) return null;

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase
    .from('api_keys')
    .select('api_key')
    .eq('provider', 'alibaba')
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.warn('[alibabaConfig] api_keys lookup failed, using env fallback:', error.message);
    return null;
  }
  const key = typeof data?.api_key === 'string' ? data.api_key.trim() : '';
  return key || null;
}

/**
 * Returns the Alibaba API key, preferring the active Supabase DB row.
 * Errors and missing rows fall back to server environment variables.
 */
export async function getAlibabaApiKey(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.key;
  if (pending) return pending;

  pending = (async () => {
    let key: string | null = null;
    try {
      key = await readDbKey();
    } catch (error: any) {
      console.warn('[alibabaConfig] api_keys lookup error, using env fallback:', error?.message || error);
      key = null;
    }
    const resolved = key || envKey();
    cached = { key: resolved, expiresAt: Date.now() + CACHE_TTL_MS };
    return resolved;
  })();

  try {
    return await pending;
  } finally {
    pending = null;
  }
}

/** For tests / key rotation: discard the in-process cached key. */
export function clearAlibabaApiKeyCache(): void {
  cached = null;
}
