-- The blog-headers bucket is public, so object URLs resolve without a SELECT
-- policy on storage.objects. The broad public SELECT policy only enabled
-- listing every file in the bucket (flagged by the Supabase linter). The app
-- only uploads + getPublicUrl (no .list()), so dropping it is safe.
drop policy if exists "blog_headers_select" on storage.objects;
