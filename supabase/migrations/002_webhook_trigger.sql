-- Database webhook: fires the process-review Edge Function on every INSERT to review_jobs.
-- Uses pg_net (available on all Supabase projects) rather than supabase_functions schema.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION notify_process_review()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://eimdgqymjwfljtapnuyl.supabase.co/functions/v1/process-review',
    body    := json_build_object('record', row_to_json(NEW))::text,
    headers := '{"Content-Type":"application/json","Authorization":"Bearer sb_publishable_ajiNEI41zC2cnOSUviu21g_qU6IwmJJ"}'::jsonb
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "on_review_job_insert"
AFTER INSERT ON "public"."review_jobs"
FOR EACH ROW EXECUTE FUNCTION notify_process_review();
