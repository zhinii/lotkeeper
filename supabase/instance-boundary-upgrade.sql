-- Run once for Lotkeeper databases created before site boundaries were added.
-- This is additive and preserves every existing instance and record.

alter table public.instances
  add column if not exists boundary jsonb not null default '[]'::jsonb;

select 'Lotkeeper instance boundary upgrade installed' as result;
