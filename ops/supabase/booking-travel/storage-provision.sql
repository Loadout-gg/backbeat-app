-- Storage provisioning for artist travel-document scans. SEPARATE from migration 009 and NOT
-- applied by it, by a deploy or by the app: running this file is Alberto's reserved operation
-- (owner decision on PR #36, D2; governance r03 point 3). Run it only after 009 and its postflight.
-- What it does, idempotently:
--   1. private bucket "artist-travel-documents": 10 MB per object, PDF / JPEG / PNG / HEIC only
--      (declared type at ingress; the app validates the observed bytes again before a scan is usable);
--   2. one RESTRICTIVE policy on storage.objects that denies anon and authenticated every
--      operation on that bucket, whatever permissive policy exists now or is added later.
--      No permissive policy is created: a browser session cannot list, read, sign, upload,
--      overwrite or remove. Only the server-side privileged client reaches the bucket.
-- It never deletes or rewrites an object or an existing policy of another bucket.
-- To verify on staging before enabling TRAVEL_DOC_SCANS_ENABLED (not verified by this file):
-- upload through a signed upload URL still works with the restrictive policy in place; a member
-- JWT gets no list / read / sign / overwrite / remove (plan HOST-01, FILE-02, FILE-03).
-- Undo: empty the bucket through the Storage API (never SQL DELETE on storage.objects), then
--   DROP POLICY backbeat_travel_documents_no_client_access ON storage.objects;
--   and delete the bucket through the Storage API or dashboard.
-- Explicit target, in the same run (staging only; production is not an allowed target):
--   SET backbeat.travel_storage_target = 'hosted:hupkygptbvnzrihrlcxv';
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $guard$
DECLARE
  target text := pg_catalog.current_setting('backbeat.travel_storage_target', true);
  expected_id text;
  expected_environment text;
BEGIN
  -- Each explicit target must match the synthetic marker of the database it names:
  --   development                  -> backbeat-dev / development (local, migration 001)
  --   hosted:hupkygptbvnzrihrlcxv  -> backbeat-staging / staging (Backbeat staging)
  -- A missing marker table (production shape), zero or several rows, other values, or a
  -- marker that belongs to the other target are all refused.
  IF target = 'development' THEN
    expected_id := 'backbeat-dev'; expected_environment := 'development';
  ELSIF target = 'hosted:hupkygptbvnzrihrlcxv' THEN
    expected_id := 'backbeat-staging'; expected_environment := 'staging';
  ELSE
    RAISE EXCEPTION 'TRAVEL_STORAGE_TARGET_NOT_EXPLICIT';
  END IF;
  IF pg_catalog.to_regclass('public.runtime_environment') IS NULL THEN
    RAISE EXCEPTION 'TRAVEL_STORAGE_SYNTHETIC_MARKER_MISSING';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.runtime_environment) <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.runtime_environment
    WHERE id = expected_id AND environment = expected_environment AND synthetic_only IS TRUE
  ) THEN
    RAISE EXCEPTION 'TRAVEL_STORAGE_MARKER_DOES_NOT_MATCH_TARGET';
  END IF;
  IF pg_catalog.to_regprocedure('public.backbeat_is_active_member(uuid)') IS NULL THEN
    RAISE EXCEPTION 'TRAVEL_STORAGE_SHAPE_MISMATCH';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES ('public.bookings'), ('public.artists'), ('public.workspaces')) AS t(name)
    WHERE pg_catalog.to_regclass(t.name) IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class
      WHERE oid = pg_catalog.to_regclass(t.name) AND relrowsecurity)
  ) THEN
    RAISE EXCEPTION 'TRAVEL_STORAGE_PARENT_RLS_REQUIRED';
  END IF;
END
$guard$;
DO $requires$
BEGIN
  IF pg_catalog.to_regclass('storage.buckets') IS NULL OR pg_catalog.to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'TRAVEL_STORAGE_SCHEMA_MISSING';
  END IF;
  IF pg_catalog.to_regclass('public.artist_travel_document_files') IS NULL THEN
    RAISE EXCEPTION 'TRAVEL_STORAGE_REQUIRES_009';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
          WHERE oid = pg_catalog.to_regclass('storage.objects')) THEN
    RAISE EXCEPTION 'TRAVEL_STORAGE_OBJECTS_RLS_REQUIRED';
  END IF;
END
$requires$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('artist-travel-documents', 'artist-travel-documents', false, 10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/heic'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = 10485760,
      allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/heic'];

DROP POLICY IF EXISTS backbeat_travel_documents_no_client_access ON storage.objects;
CREATE POLICY backbeat_travel_documents_no_client_access ON storage.objects
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (bucket_id <> 'artist-travel-documents')
  WITH CHECK (bucket_id <> 'artist-travel-documents');
COMMIT;

-- Report (the SQL editor shows the last statement): the bucket row, the restrictive policy and
-- every other policy on storage.objects that applies to anon / authenticated, for review.
SELECT 1 AS ord, 'bucket' AS item,
       pg_catalog.format('public=%s file_size_limit=%s allowed_mime_types=%s', b.public, b.file_size_limit, b.allowed_mime_types) AS detail
FROM storage.buckets AS b WHERE b.id = 'artist-travel-documents'
UNION ALL
SELECT 2, 'policy ' || p.policyname,
       pg_catalog.format('%s %s roles=%s using=%s check=%s', p.permissive, p.cmd, p.roles, p.qual, p.with_check)
FROM pg_catalog.pg_policies AS p
WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
  AND (p.roles && ARRAY['anon', 'authenticated', 'public']::name[])
ORDER BY 1, 2;
