-- =============================================================================
-- Avelut server-side provider keys: create the api_keys table used by API
-- routes and Edge Functions. Mirrors supabase/api_keys_table.sql so deployed
-- Supabase projects get the table through the normal migration workflow.
-- =============================================================================
-- Service-role-only storage for the Alibaba / DashScope key. The browser never
-- reads this table; API routes and Edge Functions resolve the key with the
-- service role and only fall back to ALIBABA_API_KEY / VITE_ALIBABA_API_KEY
-- environment variables when there is no active row or a lookup fails.
-- If SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured in an Edge
-- Function's environment, that function also uses the env fallback directly.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.api_keys (
  provider     text PRIMARY KEY,
  api_key      text NOT NULL DEFAULT '',
  workspace_id text,
  is_active    boolean NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.api_keys IS
  'Server-only provider credentials. Never expose to anon/authenticated clients.';

-- Default-deny: only an explicit policy for service_role grants access.
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access_api_keys" ON public.api_keys;
CREATE POLICY "service_role_full_access_api_keys"
  ON public.api_keys
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- No anon/authenticated policies are created. Revoke any inherited grants.
REVOKE ALL ON TABLE public.api_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.api_keys TO service_role;

-- Keep secrets out of Realtime.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'api_keys'
     ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.api_keys;
  END IF;
END $$;

-- Upsert the Alibaba key (replace the placeholder value before running):
-- INSERT INTO public.api_keys (provider, api_key, workspace_id, is_active)
-- VALUES ('alibaba', 'sk-REPLACE_ME', 'ws-REPLACE_ME', true)
-- ON CONFLICT (provider) DO UPDATE
--   SET api_key = EXCLUDED.api_key,
--       workspace_id = EXCLUDED.workspace_id,
--       is_active = EXCLUDED.is_active,
--       updated_at = now();
