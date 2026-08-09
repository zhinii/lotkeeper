-- Add configurable modules, flexible fields, anonymous submissions, and updater attribution.
-- Additive upgrade; existing instances and records are preserved.

alter table public.instances add column if not exists module_definitions jsonb not null default '[]'::jsonb;
alter table public.records add column if not exists data jsonb not null default '{}'::jsonb;
alter table public.records add column if not exists updated_by_email text;
alter table public.submissions add column if not exists data jsonb not null default '{}'::jsonb;
alter table public.submissions alter column contact_name drop not null;
alter table public.submissions alter column contact_method drop not null;
alter table public.submissions alter column contact_value drop not null;
alter table public.submissions drop constraint if exists submissions_contact_method_check;
alter table public.records drop constraint if exists records_record_type_check;
alter table public.submissions drop constraint if exists submissions_record_type_check;

update public.instances instance
set module_definitions = coalesce((
  select jsonb_agg(jsonb_build_object(
    'id', module_id,
    'name', coalesce(instance.terminology ->> module_id, initcap(replace(module_id, '_', ' '))),
    'public_visible', true,
    'public_submit', true,
    'fields', '[]'::jsonb
  ))
  from jsonb_array_elements_text(instance.modules) module_id
), '[]'::jsonb)
where instance.module_definitions = '[]'::jsonb;

create or replace function public.can_view_module(target uuid, module_id text)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.instances i where i.id=target and (
  exists(select 1 from public.instance_members m where m.instance_id=i.id and m.user_id=auth.uid())
  or i.module_definitions='[]'::jsonb
  or exists(select 1 from jsonb_array_elements(i.module_definitions) d where d->>'id'=module_id and coalesce((d->>'public_visible')::boolean,false))
)) $$;

create or replace function public.can_submit_module(target uuid, module_id text)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.instances i where i.id=target and (
  i.module_definitions='[]'::jsonb
  or exists(select 1 from jsonb_array_elements(i.module_definitions) d where d->>'id'=module_id and coalesce((d->>'public_submit')::boolean,false))
)) $$;

drop policy if exists "visible records can be read" on public.records;
create policy "visible records can be read" on public.records for select using (public.can_view_instance(instance_id) and (public.is_instance_admin(instance_id) or (public_visible and public.can_view_module(instance_id,record_type))));
drop policy if exists "visitors submit to visible instances" on public.submissions;
create policy "visitors submit to visible instances" on public.submissions for insert to anon,authenticated with check (status='pending' and public.can_view_instance(instance_id) and public.can_submit_module(instance_id,record_type));

select 'Lotkeeper configurable modules upgrade installed' as result;
