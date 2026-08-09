-- Lotkeeper multi-organization schema for the existing Supabase project.
-- Run once in Supabase SQL Editor before using the GitHub Pages application.

create extension if not exists pgcrypto;

create table if not exists public.instances (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  site_name text not null default 'Main Site',
  access_mode text not null default 'public' check (access_mode in ('public','private')),
  modules jsonb not null default '["places"]'::jsonb,
  terminology jsonb not null default '{}'::jsonb,
  latitude double precision not null,
  longitude double precision not null,
  map_zoom integer not null default 17 check (map_zoom between 3 and 22),
  boundary jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Safe upgrade for projects that installed an earlier Lotkeeper schema.
alter table public.instances add column if not exists boundary jsonb not null default '[]'::jsonb;

create table if not exists public.instance_members (
  instance_id uuid not null references public.instances(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('admin','staff','viewer')),
  created_at timestamptz not null default now(),
  primary key (instance_id,user_id)
);

create table if not exists public.records (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.instances(id) on delete cascade,
  record_type text not null check (record_type in ('places','assets','stock','loose_material')),
  name text not null,
  code text,
  category text not null,
  description text,
  status text not null default 'active',
  quantity numeric,
  unit text,
  location_label text,
  latitude double precision not null,
  longitude double precision not null,
  photo_path text,
  public_visible boolean not null default true,
  source_submission_id uuid,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.instances(id) on delete cascade,
  submission_type text not null check (submission_type in ('new_record','stock_change')),
  record_type text not null check (record_type in ('places','assets','stock','loose_material')),
  item_name text not null,
  category text not null,
  description text,
  quantity numeric,
  quantity_unit text,
  latitude double precision not null,
  longitude double precision not null,
  gps_latitude double precision not null,
  gps_longitude double precision not null,
  gps_accuracy double precision,
  contact_name text not null,
  contact_method text not null check (contact_method in ('phone','email','assigned_username')),
  contact_value text not null,
  photo_path text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  moderated_by uuid references auth.users(id),
  moderated_at timestamptz,
  submitted_at timestamptz not null default now()
);

create table if not exists public.stock_events (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.instances(id) on delete cascade,
  submission_id uuid references public.submissions(id),
  record_id uuid references public.records(id),
  item_name text not null,
  event_type text not null,
  quantity numeric not null,
  unit text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_instances_access_name on public.instances(access_mode,name);
create index if not exists idx_records_instance_type on public.records(instance_id,record_type);
create index if not exists idx_records_instance_visible on public.records(instance_id,public_visible);
create index if not exists idx_submissions_instance_status on public.submissions(instance_id,status,submitted_at desc);
create index if not exists idx_stock_events_instance_created on public.stock_events(instance_id,created_at desc);

alter table public.instances enable row level security;
alter table public.instance_members enable row level security;
alter table public.records enable row level security;
alter table public.submissions enable row level security;
alter table public.stock_events enable row level security;

create or replace function public.is_instance_admin(target uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.instance_members where instance_id=target and user_id=auth.uid() and role='admin') $$;

create or replace function public.can_view_instance(target uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.instances where id=target and (access_mode='public' or created_by=auth.uid() or exists(select 1 from public.instance_members where instance_id=target and user_id=auth.uid()))) $$;

drop policy if exists "instances visible by access" on public.instances;
create policy "instances visible by access" on public.instances for select using (access_mode='public' or created_by=auth.uid() or public.can_view_instance(id));
drop policy if exists "authenticated create instances" on public.instances;
create policy "authenticated create instances" on public.instances for insert to authenticated with check (created_by=auth.uid());
drop policy if exists "admins update instances" on public.instances;
create policy "admins update instances" on public.instances for update to authenticated using (created_by=auth.uid() or public.is_instance_admin(id)) with check (created_by=auth.uid() or public.is_instance_admin(id));

drop policy if exists "members see membership" on public.instance_members;
create policy "members see membership" on public.instance_members for select to authenticated using (user_id=auth.uid() or public.is_instance_admin(instance_id));
drop policy if exists "creator adds first membership" on public.instance_members;
create policy "creator adds first membership" on public.instance_members for insert to authenticated with check (user_id=auth.uid() and exists(select 1 from public.instances where id=instance_id and created_by=auth.uid()) or public.is_instance_admin(instance_id));
drop policy if exists "admins manage membership" on public.instance_members;
create policy "admins manage membership" on public.instance_members for update to authenticated using (public.is_instance_admin(instance_id)) with check (public.is_instance_admin(instance_id));

drop policy if exists "visible records can be read" on public.records;
create policy "visible records can be read" on public.records for select using (public.can_view_instance(instance_id) and (public_visible or public.is_instance_admin(instance_id)));
drop policy if exists "admins create records" on public.records;
create policy "admins create records" on public.records for insert to authenticated with check (public.is_instance_admin(instance_id));
drop policy if exists "admins update records" on public.records;
create policy "admins update records" on public.records for update to authenticated using (public.is_instance_admin(instance_id)) with check (public.is_instance_admin(instance_id));

drop policy if exists "visitors submit to visible instances" on public.submissions;
create policy "visitors submit to visible instances" on public.submissions for insert to anon,authenticated with check (status='pending' and public.can_view_instance(instance_id));
drop policy if exists "admins review submissions" on public.submissions;
create policy "admins review submissions" on public.submissions for select to authenticated using (public.is_instance_admin(instance_id));
drop policy if exists "admins moderate submissions" on public.submissions;
create policy "admins moderate submissions" on public.submissions for update to authenticated using (public.is_instance_admin(instance_id)) with check (public.is_instance_admin(instance_id));

drop policy if exists "members see stock history" on public.stock_events;
create policy "members see stock history" on public.stock_events for select to authenticated using (public.can_view_instance(instance_id));
drop policy if exists "admins record stock events" on public.stock_events;
create policy "admins record stock events" on public.stock_events for insert to authenticated with check (public.is_instance_admin(instance_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('submission-media','submission-media',false,10485760,array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('public-media','public-media',true,10485760,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=true,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "visitors upload submission photos" on storage.objects;
create policy "visitors upload submission photos" on storage.objects for insert to anon,authenticated with check (bucket_id='submission-media' and public.can_view_instance(((storage.foldername(name))[1])::uuid));
drop policy if exists "admins read submission photos" on storage.objects;
create policy "admins read submission photos" on storage.objects for select to authenticated using (bucket_id='submission-media' and public.is_instance_admin(((storage.foldername(name))[1])::uuid));
drop policy if exists "admins publish photos" on storage.objects;
create policy "admins publish photos" on storage.objects for insert to authenticated with check (bucket_id='public-media' and public.is_instance_admin(((storage.foldername(name))[1])::uuid));
drop policy if exists "public reads published photos" on storage.objects;
create policy "public reads published photos" on storage.objects for select using (bucket_id='public-media');

grant usage on schema public to anon,authenticated;
grant select on public.instances,public.records to anon,authenticated;
grant insert on public.submissions to anon,authenticated;
grant select,insert,update,delete on public.instances,public.instance_members,public.records,public.submissions,public.stock_events to authenticated;

select 'Lotkeeper schema installed' as result;
