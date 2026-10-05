\set ON_ERROR_STOP on
select '| ' || namespaces.nspname || '.' || tables.relname || ' | ' || (
  select string_agg('`' || attributes.attname || ' ' || pg_catalog.format_type(attributes.atttypid, attributes.atttypmod)
    || case when attributes.attnotnull then '' else '?' end || '`', '; ' order by attributes.attnum)
  from pg_catalog.pg_attribute as attributes where attributes.attrelid = tables.oid and attributes.attnum > 0 and not attributes.attisdropped
) || ' | ' || coalesce((
  select string_agg('`' || constraints.conname || '`: ' || replace(pg_catalog.pg_get_constraintdef(constraints.oid), E'\n', ' '), '; ' order by constraints.conname)
  from pg_catalog.pg_constraint as constraints where constraints.conrelid = tables.oid
), 'none') || ' | ' || coalesce((
  select string_agg('`' || indexes.indexname || '`: ' || indexes.indexdef, '; ' order by indexes.indexname)
  from pg_catalog.pg_indexes as indexes where indexes.schemaname = namespaces.nspname and indexes.tablename = tables.relname
), 'none') || ' |'
from pg_catalog.pg_class as tables join pg_catalog.pg_namespace as namespaces on namespaces.oid = tables.relnamespace
where tables.relkind = 'r' and (namespaces.nspname = 'public' or
  (namespaces.nspname = 'private' and tables.relname in ('booking_policy', 'admin_bootstrap_guard')))
order by namespaces.nspname, tables.relname;
