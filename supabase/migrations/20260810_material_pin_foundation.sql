-- Material Pin foundation: one product model, public search analytics and
-- cost-limited photo search. Existing records and organizations are retained.

alter table public.organizations
  add column if not exists ai_catalog_context text not null default '';

alter table public.organizations
  drop constraint if exists organizations_mode_check;

update public.organizations set mode = 'material'
where mode in ('civic', 'commercial');

alter table public.organizations
  add constraint organizations_mode_check check (mode = 'material');

alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_purpose_check;
alter table public.ai_usage_events
  add constraint ai_usage_events_purpose_check
  check (purpose in ('preview', 'submission', 'search'));

alter table public.search_events alter column user_id drop not null;
alter table public.search_events
  add column if not exists search_type text not null default 'text'
  check (search_type in ('text', 'image', 'filter'));
alter table public.search_events
  add column if not exists filters jsonb not null default '{}'::jsonb;

create or replace function public.collection_accepts_public(
  target uuid,
  collection_key text
)
returns boolean language sql stable security definer set search_path=public
as $$ select false $$;

create or replace function public.can_upload_submission_media(target uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select public.is_org_member(target) $$;

create or replace function public.log_material_search(
  target_organization uuid,
  search_query text,
  search_kind text,
  search_filters jsonb,
  matching_records integer
)
returns uuid language plpgsql security definer set search_path=public
as $$
declare new_id uuid;
begin
  if search_kind not in ('text', 'image', 'filter') then
    raise exception 'Unsupported search type';
  end if;
  if not exists (
    select 1 from public.organizations
    where id = target_organization
      and (public_access or public.is_org_member(id))
  ) then
    raise exception 'Organization is not available';
  end if;
  insert into public.search_events(
    organization_id,
    user_id,
    query,
    search_type,
    filters,
    result_count
  ) values (
    target_organization,
    auth.uid(),
    left(coalesce(nullif(trim(search_query), ''), 'Browse filters'), 500),
    search_kind,
    coalesce(search_filters, '{}'::jsonb),
    greatest(0, matching_records)
  ) returning id into new_id;
  return new_id;
end
$$;

grant execute on function public.log_material_search(uuid,text,text,jsonb,integer)
  to anon, authenticated;

select 'Material Pin foundation installed' as result;
