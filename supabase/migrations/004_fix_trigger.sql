-- Fix pg_net trigger argument types.
-- Migration 002 called net.http_post with:
--   url  as 'unknown' (bare string literal, no cast)
--   body as 'text'    (json_build_object::text)
-- but the actual pg_net signature is:
--   net.http_post(url text, body jsonb, headers jsonb, ...)
-- PostgreSQL error 42883 fires on every INSERT, rolling back the row.
-- This replaces the function in-place (no trigger recreation needed).

CREATE OR REPLACE FUNCTION notify_process_review()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://eimdgqymjwfljtapnuyl.supabase.co/functions/v1/process-review'::text,
    body    := json_build_object('record', row_to_json(NEW))::jsonb,
    headers := '{"Content-Type":"application/json","Authorization":"Bearer sb_publishable_ajiNEI41zC2cnOSUviu21g_qU6IwmJJ"}'::jsonb
  );
  RETURN NEW;
END;
$$;
