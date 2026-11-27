/**
 * Deno-compatible server key resolution for Supabase Edge Functions.
 *
 * DB-first: active `api_keys` row for provider = 'alibaba', then env fallback
 * (ALIBABA_API_KEY / VITE_ALIBABA_API_KEY) when the row is missing, inactive,
 * empty, or the lookup fails. If SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
 * unavailable in the Edge environment, the env fallback is used directly.
 *
 * See supabase/api_keys_table.sql for the table definition and RLS policy.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const CACHE_TTL_MS = 60_000;

let cachedKey: string | null = null;
let cacheExpiresAt = 0;
let pending: Promise<string> | null = null;

function envKey(): string {
  for (const name of ["ALIBABA_API_KEY", "VITE_ALIBABA_API_KEY"]) {
    const value = Deno.env.get(name)?.trim();
    if (value) return value;
  }
  return "";
}

async function readDbKey(): Promise<string | null> {
  const url = Deno.env.get("SUPABASE_URL")?.trim() || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";
  if (!url || !serviceKey) return null;

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin
    .from("api_keys")
    .select("api_key")
    .eq("provider", "alibaba")
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.warn("[alibabaConfig] api_keys lookup failed, using env fallback:", error.message);
    return null;
  }
  const key = typeof data?.api_key === "string" ? data.api_key.trim() : "";
  return key || null;
}

/** Returns the DB-managed key when available, otherwise the env fallback. */
export async function getAlibabaApiKey(): Promise<string> {
  if (cachedKey && cacheExpiresAt > Date.now()) return cachedKey;
  if (pending) return pending;

  pending = (async () => {
    let key: string | null = null;
    try {
      key = await readDbKey();
    } catch (error) {
      console.warn("[alibabaConfig] api_keys lookup error, using env fallback:", error);
      key = null;
    }
    const resolved = key || envKey();
    cachedKey = resolved;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
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
  cachedKey = null;
  cacheExpiresAt = 0;
}
