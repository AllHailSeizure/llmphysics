-- Grant table-level permissions to anon and authenticated roles.
-- RLS policies control row-level access, but database-level GRANTs are also
-- required. Without these, non-service-role keys get 404 from PostgREST
-- even when RLS policies are permissive.
GRANT SELECT, INSERT, UPDATE ON review_jobs TO anon;
GRANT SELECT, INSERT, UPDATE ON review_jobs TO authenticated;
