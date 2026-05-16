-- Remove pedro@meetavila.com and pedroavila.phm@gmail.com from every RLS policy.
-- Keep pedro@cerebroai.au (primary) and avila.phm@gmail.com only.
-- Uses dynamic SQL to update all ~70 affected policies in one pass.

DO $$
DECLARE
  r RECORD;
  new_qual text;
  new_check text;
  old3 text := 'ARRAY[''pedro@meetavila.com''::text, ''pedroavila.phm@gmail.com''::text, ''pedro@cerebroai.au''::text]';
  old4 text := 'ARRAY[''pedro@meetavila.com''::text, ''pedroavila.phm@gmail.com''::text, ''pedro@cerebroai.au''::text, ''avila.phm@gmail.com''::text]';
  new_arr text := 'ARRAY[''pedro@cerebroai.au''::text, ''avila.phm@gmail.com''::text]';
BEGIN
  FOR r IN
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      pol.polname AS policy_name,
      pg_get_expr(pol.polqual, pol.polrelid) AS qual,
      pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE (
      pg_get_expr(pol.polqual, pol.polrelid) LIKE '%meetavila%'
      OR pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%meetavila%'
      OR pg_get_expr(pol.polqual, pol.polrelid) LIKE '%pedroavila.phm%'
      OR pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%pedroavila.phm%'
    )
  LOOP
    new_qual  := replace(replace(coalesce(r.qual, ''),  old4, new_arr), old3, new_arr);
    new_check := replace(replace(coalesce(r.with_check, ''), old4, new_arr), old3, new_arr);

    IF r.qual IS NOT NULL AND r.with_check IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s) WITH CHECK (%s)',
        r.policy_name, r.schema_name, r.table_name, new_qual, new_check);
    ELSIF r.qual IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)',
        r.policy_name, r.schema_name, r.table_name, new_qual);
    ELSIF r.with_check IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (%s)',
        r.policy_name, r.schema_name, r.table_name, new_check);
    END IF;
  END LOOP;
END $$;
