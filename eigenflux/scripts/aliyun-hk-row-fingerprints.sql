-- Run on frozen source and freshly restored target BEFORE starting writers.
-- Outputs only relation names, row counts and SHA-256 fingerprints, no row data.
\set ON_ERROR_STOP on
SET timezone='UTC';
SET datestyle='ISO, YMD';
SET extra_float_digits=3;
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT format(
 'SELECT %L AS relation, count(*) AS rows, encode(sha256(convert_to(COALESCE(string_agg(h, '''' ORDER BY h COLLATE "C"), ''''), ''UTF8'')), ''hex'') AS rows_sha256 FROM (SELECT encode(sha256(convert_to(row_to_json(t)::text, ''UTF8'')), ''hex'') h FROM ONLY %I.%I t) s;',
 n.nspname||'.'||c.relname,n.nspname,c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
ORDER BY n.nspname,c.relname
\gexec
SELECT format('SELECT %L AS sequence, last_value, is_called FROM %I.%I;',n.nspname||'.'||c.relname,n.nspname,c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind='S' AND n.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY n.nspname,c.relname
\gexec
COMMIT;
