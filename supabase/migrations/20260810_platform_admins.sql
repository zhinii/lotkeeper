-- Apply to an existing Lotkeeper V2 project before inviting the first admin.
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

drop policy if exists platform_admin_self_read on public.platform_admins;
create policy platform_admin_self_read on public.platform_admins
for select to authenticated using (user_id=auth.uid());

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.platform_admins where user_id=auth.uid()) $$;

create or replace function public.create_organization(org_name text, org_slug text, org_mode text, is_public boolean, latitude double precision, longitude double precision, zoom_level integer, collection_config jsonb)
returns uuid language plpgsql security definer set search_path=public
as $$ declare new_id uuid; begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_platform_admin() then raise exception 'Platform administrator access required'; end if;
  insert into public.organizations(name,slug,mode,public_access,center_lat,center_lng,map_zoom,collections,created_by) values(trim(org_name),lower(trim(org_slug)),org_mode,is_public,latitude,longitude,zoom_level,collection_config,auth.uid()) returning id into new_id;
  insert into public.organization_members(organization_id,user_id,role) values(new_id,auth.uid(),'admin');
  return new_id;
end $$;

grant select on public.platform_admins to authenticated;
grant execute on function public.is_platform_admin to authenticated;
